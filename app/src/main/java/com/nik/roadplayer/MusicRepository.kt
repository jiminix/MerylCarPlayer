package com.nik.roadplayer

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.AtomicFile
import android.util.Base64
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Size
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class MusicRepository(private val context: Context) {

    private val onlineCoverSemaphore = Semaphore(3)
    private val failedOnlineLookups = ConcurrentHashMap.newKeySet<String>()
    private val musicBrainzLock = Any()
    @Volatile private var lastMusicBrainzRequestAt = 0L
    private val coverDirectory = File(context.filesDir, "roadplayer_covers").apply { mkdirs() }
    private val customCoverDirectory = File(context.filesDir, "roadplayer_custom_covers").apply { mkdirs() }
    // V0.22 : cache persistant des tags audio. Un rafraîchissement ne relit plus
    // tous les MP3/FLAC avec MediaMetadataRetriever ; seuls les nouveaux fichiers
    // ou ceux dont la taille/date ont changé sont réellement analysés.
    private val tagCacheFile = File(context.filesDir, "roadplayer_tag_cache_v1.json")
    // Les tags détaillés ne sont nécessaires qu'au SCAN, pas pour afficher
    // la bibliothèque déjà indexée. Ne les charger qu'à la première utilisation.
    private val tagCache by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        ConcurrentHashMap<String, CachedTagEntry>().apply {
            putAll(loadTagCache())
        }
    }
    // V0.23 : index persistant de toute la bibliothèque. Si MediaStore n'a pas
    // changé, RoadPlayer reconstruit les albums depuis cet index sans rescanner
    // la carte SD. Si quelque chose a changé, une requête très légère compare
    // seulement id/date/taille puis seuls les nouveaux fichiers ou fichiers
    // modifiés sont relus complètement.
    private val trackIndexFile = File(context.filesDir, "roadplayer_track_index_v1.json")
    private val trackIndex = ConcurrentHashMap<String, CachedIndexedTrack>().apply {
        putAll(loadTrackIndex())
    }
    private val scanStatePrefs = context.getSharedPreferences(
        "roadplayer_scan_state_v1",
        Context.MODE_PRIVATE
    )
    // V0.28 : mémorise uniquement l'état des dossiers d'albums physiques
    // sous Music/. Cela permet de repérer un dossier copié par ADB avant même
    // qu'Android ne l'ait ajouté à MediaStore, sans rescanner toute la carte.
    private val physicalScanPrefs = context.getSharedPreferences(
        "roadplayer_physical_scan_v1",
        Context.MODE_PRIVATE
    )
    private val albumMetadataPrefs = context.getSharedPreferences(
        "roadplayer_album_metadata",
        Context.MODE_PRIVATE
    )
    private val hiddenAlbumsPrefs = context.getSharedPreferences(
        "roadplayer_hidden_albums",
        Context.MODE_PRIVATE
    )
    private val playlistPrefs = context.getSharedPreferences(
        "roadplayer_playlists",
        Context.MODE_PRIVATE
    )
    private val mergePrefs = context.getSharedPreferences(
        "roadplayer_album_merges",
        Context.MODE_PRIVATE
    )
    private val PLAYLIST_NAMES_KEY = "playlist_names"
    private val MERGE_GROUP_IDS_KEY = "merge_group_ids"


    /**
     * V0.26 - Rafraîchissement ultra-rapide.
     *
     * Android 11+ fournit un compteur de génération MediaStore. Au lieu de relire
     * tous les morceaux quand ce compteur a changé, on demande uniquement les lignes
     * dont GENERATION_ADDED / GENERATION_MODIFIED est postérieure à notre dernier
     * compteur. Si rien n'a changé, aucune requête de fichiers n'est effectuée.
     *
     * Le scan complet historique reste utilisé uniquement pour construire l'index la
     * première fois, ou comme solution de repli si MediaStore ne fournit pas les
     * informations incrémentales.
     */
    /**
     * Restitue immédiatement la bibliothèque connue sans analyser les fichiers.
     * Le contrôle incrémental continue en arrière-plan après l'affichage.
     * Aucun état du disque ou de l'index n'est modifié ici.
     */
    suspend fun cachedAlbumsFromSdMusic(): List<Album> = withContext(Dispatchers.IO) {
        if (trackIndex.isEmpty()) return@withContext emptyList()
        // Un volume SD peut ne pas encore être déclaré par Android au lancement.
        // L'index local reste disponible même pendant le montage de la carte.
        val tracks = trackIndex.entries.asSequence()
            .map { (_, cached) ->
                TaggedTrack(
                    track = cached.track,
                    groupAlbumTitle = cached.groupAlbumTitle,
                    groupIdentity = cached.groupIdentity
                )
            }
            .toList()
        if (tracks.isEmpty()) emptyList() else buildAlbumsFromTaggedTracks(tracks)
    }

    suspend fun quickRefreshAlbumsFromSdMusic(
        includePhysicalChanges: Boolean = true,
        onProgress: suspend (Float) -> Unit = {}
    ): List<Album> = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val volumes = MediaStore.getExternalVolumeNames(context)
            .filter { it != MediaStore.VOLUME_EXTERNAL_PRIMARY }

        if (volumes.isEmpty()) {
            onProgress(1f)
            return@withContext emptyList()
        }

        onProgress(0.03f)

        // V0.28 : les fichiers copiés par ADB peuvent être physiquement présents
        // sur la microSD mais encore absents de MediaStore. On ne regarde que les
        // dossiers de premier niveau de Music/ ; seuls les nouveaux/modifiés sont
        // envoyés au MediaScanner. Si rien n'a changé, ce contrôle est quasi instantané.
        if (includePhysicalChanges &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            trackIndex.isNotEmpty()
        ) {
            ensurePhysicalMusicChangesIndexed(volumes)
        }
        onProgress(0.16f)

        // Sans index existant, on fait une seule fois le scan complet qui construit le cache.
        val indexUsable = volumes.all { volume ->
            scanStatePrefs.getBoolean(scanReadyKey(volume), false) &&
                trackIndex.keys.any { it.startsWith("$volume:") }
        }
        if (!indexUsable || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            // Sur le premier lancement, ne pas extraire les tags un fichier à la fois.
            // MediaStore donne immédiatement les informations essentielles.
            return@withContext loadAlbumsFromSdMusic(
                onProgress = onProgress,
                fastMetadataOnly = !includePhysicalChanges && trackIndex.isEmpty()
            )
        }

        var anyIndexChange = false
        var anyTagChange = false

        for ((volumeIndex, volume) in volumes.withIndex()) {
            val volumeBase = 0.18f + (volumeIndex.toFloat() / volumes.size.coerceAtLeast(1)) * 0.66f
            val volumeSpan = 0.66f / volumes.size.coerceAtLeast(1)
            onProgress(volumeBase)
            val generationNow = mediaStoreGeneration(volume)
                ?: return@withContext loadAlbumsFromSdMusic(onProgress)
            val storedGeneration = scanStatePrefs.getLong(scanGenerationKey(volume), Long.MIN_VALUE)

            // Le cas le plus fréquent : strictement rien n'a changé depuis le dernier ↻.
            if (storedGeneration != Long.MIN_VALUE && generationNow == storedGeneration) {
                onProgress(volumeBase + volumeSpan)
                continue
            }
            if (storedGeneration == Long.MIN_VALUE || generationNow < storedGeneration) {
                // Base MediaStore recréée / compteur réinitialisé : reconstruire une fois proprement.
                return@withContext loadAlbumsFromSdMusic(onProgress)
            }

            val collection = MediaStore.Audio.Media.getContentUri(volume)
            val baseSelection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?"
            val deltaSelection = "$baseSelection AND (${MediaStore.MediaColumns.GENERATION_ADDED} > ? OR ${MediaStore.MediaColumns.GENERATION_MODIFIED} > ?)"
            val deltaArgs = arrayOf("Music/%", storedGeneration.toString(), storedGeneration.toString())
            val changedIds = mutableListOf<Long>()
            var deltaSucceeded = false

            resolver.query(
                collection,
                arrayOf(MediaStore.Audio.Media._ID),
                deltaSelection,
                deltaArgs,
                null
            )?.use { cursor ->
                deltaSucceeded = true
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val total = cursor.count.coerceAtLeast(1)
                var read = 0
                while (cursor.moveToNext()) {
                    changedIds += cursor.getLong(idCol)
                    read++
                    if (read == total || read % 50 == 0) {
                        onProgress(volumeBase + volumeSpan * 0.30f * (read.toFloat() / total))
                    }
                }
            }

            onProgress(volumeBase + volumeSpan * 0.35f)

            // Si la requête incrémentale échoue, on préfère la méthode sûre existante.
            if (!deltaSucceeded) return@withContext loadAlbumsFromSdMusic(onProgress)

            if (changedIds.isNotEmpty()) {
                val uniqueIds = changedIds.distinct()
                val result = updateIndexForChangedIds(
                    volume = volume,
                    collection = collection,
                    ids = uniqueIds,
                    onItemProgress = { fraction ->
                        onProgress(volumeBase + volumeSpan * (0.35f + 0.53f * fraction))
                    }
                )
                anyIndexChange = anyIndexChange || result.first
                anyTagChange = anyTagChange || result.second
            }
            onProgress(volumeBase + volumeSpan * 0.88f)

            // Même si le changement MediaStore ne concernait pas notre dossier Music,
            // on mémorise la génération : le prochain ↻ pourra donc être instantané.
            scanStatePrefs.edit()
                .putLong(scanGenerationKey(volume), generationNow)
                .putBoolean(scanReadyKey(volume), true)
                .apply()
            onProgress(volumeBase + volumeSpan)
        }

        onProgress(0.88f)
        if (anyIndexChange) saveTrackIndex()
        if (anyTagChange) saveTagCache()

        val activePrefixes = volumes.map { "$it:" }
        val taggedTracks = trackIndex.entries.asSequence()
            .filter { (key, _) -> activePrefixes.any { key.startsWith(it) } }
            .map { (_, cached) ->
                TaggedTrack(
                    track = cached.track,
                    groupAlbumTitle = cached.groupAlbumTitle,
                    groupIdentity = cached.groupIdentity
                )
            }
            .toList()

        onProgress(0.96f)
        val result = buildAlbumsFromTaggedTracks(taggedTracks)
        onProgress(1f)
        result
    }

    /**
     * Détecte les albums présents physiquement dans /Music mais pas encore indexés
     * par Android. Le contrôle porte uniquement sur les entrées de premier niveau,
     * donc il reste très rapide même avec une grosse discothèque.
     */
    private fun ensurePhysicalMusicChangesIndexed(volumes: List<String>) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || trackIndex.isEmpty()) return

        val storageManager = context.getSystemService(StorageManager::class.java) ?: return
        val storageVolumes = storageManager.storageVolumes

        for (volume in volumes) {
            val storageVolume = storageVolumes.firstOrNull {
                runCatching { it.mediaStoreVolumeName }
                    .getOrNull()
                    ?.equals(volume, ignoreCase = true) == true
            } ?: continue

            val root = runCatching { storageVolume.directory }.getOrNull() ?: continue
            val musicDir = File(root, "Music")
            val entries = runCatching { musicDir.listFiles()?.toList().orEmpty() }
                .getOrDefault(emptyList())
            if (entries.isEmpty()) continue

            val prefix = "$volume:"
            val knownAlbumFolders = trackIndex.entries.asSequence()
                .filter { (key, _) -> key.startsWith(prefix) }
                .mapNotNull { (_, value) -> topLevelMusicFolder(value.track.relativePath) }
                .toHashSet()

            val bootstrapEditor = physicalScanPrefs.edit()
            val candidates = mutableListOf<PhysicalScanCandidate>()

            entries.forEach { entry ->
                if (!entry.isDirectory) return@forEach

                val folderName = entry.name
                val stateKey = physicalFolderStateKey(volume, folderName)
                val currentStamp = entry.lastModified()
                val previousStamp = physicalScanPrefs.getLong(stateKey, Long.MIN_VALUE)
                val alreadyKnown = folderName in knownAlbumFolders

                when {
                    !alreadyKnown -> {
                        val files = collectSupportedAudioFiles(entry)
                        if (files.isNotEmpty()) {
                            candidates += PhysicalScanCandidate(stateKey, currentStamp, files)
                        }
                    }
                    previousStamp == Long.MIN_VALUE -> {
                        // Première V0.28 : on initialise le cache sans rescanner les
                        // albums déjà connus de RoadPlayer.
                        bootstrapEditor.putLong(stateKey, currentStamp)
                    }
                    previousStamp != currentStamp -> {
                        val files = collectSupportedAudioFiles(entry)
                        if (files.isNotEmpty()) {
                            candidates += PhysicalScanCandidate(stateKey, currentStamp, files)
                        }
                    }
                }
            }
            bootstrapEditor.apply()

            candidates.forEach { candidate ->
                if (scanPhysicalFiles(candidate.files)) {
                    physicalScanPrefs.edit()
                        .putLong(candidate.stateKey, candidate.stamp)
                        .apply()
                }
            }
        }
    }

    private fun topLevelMusicFolder(relativePath: String): String? {
        val normalized = relativePath.replace('\\', '/').trim('/')
        if (!normalized.startsWith("Music/", ignoreCase = true)) return null
        val rest = normalized.substringAfter('/', "")
        if (rest.isBlank()) return null
        return rest.substringBefore('/').takeIf { it.isNotBlank() }
    }

    private fun physicalFolderStateKey(volume: String, folderName: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
            .digest(folderName.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return "folder.$volume.$digest"
    }

    private fun collectSupportedAudioFiles(folder: File): List<File> {
        return runCatching {
            folder.walkTopDown()
                .filter { it.isFile && isSupported(it.name) }
                .take(2000)
                .toList()
        }.getOrDefault(emptyList())
    }

    /**
     * V0.29 - Ajout manuel d'un album depuis le sélecteur de dossiers Android.
     *
     * La bibliothèque MerylCarPlayer reste volontairement basée sur /Music. Le
     * bouton + permet donc de sélectionner un dossier d'album déjà présent sous
     * Music, puis force son indexation immédiate dans MediaStore.
     *
     * Retour :
     *  - -1 : dossier hors Music / non résolu ;
     *  -  0 : aucun fichier audio pris en charge ;
     *  - >0 : nombre de fichiers envoyés au MediaScanner.
     */
    suspend fun scanSelectedAlbumFolder(treeUri: Uri): Int = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@withContext -1

        val documentId = runCatching { DocumentsContract.getTreeDocumentId(treeUri) }
            .getOrNull()
            ?: return@withContext -1
        val separator = documentId.indexOf(':')
        val volumeId = if (separator >= 0) documentId.substring(0, separator) else documentId
        val relativePath = if (separator >= 0) documentId.substring(separator + 1) else ""
        val normalizedRelative = relativePath.replace('\\', '/').trim('/')

        if (normalizedRelative.isBlank() ||
            !(normalizedRelative.equals("Music", ignoreCase = true) ||
                normalizedRelative.startsWith("Music/", ignoreCase = true))
        ) {
            return@withContext -1
        }

        val storageManager = context.getSystemService(StorageManager::class.java)
            ?: return@withContext -1
        if (volumeId.equals("primary", ignoreCase = true)) return@withContext -1

        val storageVolume = storageManager.storageVolumes.firstOrNull { volume ->
            !volume.isPrimary && (
                volume.uuid?.equals(volumeId, ignoreCase = true) == true ||
                    runCatching { volume.mediaStoreVolumeName }
                        .getOrNull()
                        ?.equals(volumeId, ignoreCase = true) == true
            )
        } ?: return@withContext -1

        val root = runCatching { storageVolume.directory }.getOrNull()
            ?: return@withContext -1
        val folder = File(root, normalizedRelative)
        if (!folder.exists() || !folder.isDirectory) return@withContext -1

        val files = collectSupportedAudioFiles(folder)
        if (files.isEmpty()) return@withContext 0

        if (scanPhysicalFiles(files)) files.size else 0
    }

    /**
     * Force Android à inscrire les fichiers ADB dans MediaStore et attend les
     * callbacks du scanner. On n'appelle cette fonction que pour les dossiers
     * réellement nouveaux/modifiés.
     */
    private fun scanPhysicalFiles(files: List<File>): Boolean {
        if (files.isEmpty()) return false

        val paths = files.map { it.absolutePath }.distinct()
        val latch = CountDownLatch(paths.size)
        val success = AtomicInteger(0)

        return try {
            MediaScannerConnection.scanFile(
                context,
                paths.toTypedArray(),
                null
            ) { _, uri ->
                if (uri != null) success.incrementAndGet()
                latch.countDown()
            }

            val completed = latch.await(30, TimeUnit.SECONDS)
            completed && success.get() == paths.size
        } catch (_: Throwable) {
            false
        }
    }

    private data class PhysicalScanCandidate(
        val stateKey: String,
        val stamp: Long,
        val files: List<File>
    )

    /** Met à jour uniquement les IDs que MediaStore signale comme ajoutés/modifiés. */
    private suspend fun updateIndexForChangedIds(
        volume: String,
        collection: Uri,
        ids: List<Long>,
        onItemProgress: suspend (Float) -> Unit = {}
    ): Pair<Boolean, Boolean> {
        if (ids.isEmpty()) return false to false

        var indexChanged = false
        var tagCacheChanged = false
        var processedItems = 0
        val totalItems = ids.size.coerceAtLeast(1)
        val resolver = context.contentResolver
        val fullProjection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.SIZE
        )
        val baseSelection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?"

        ids.chunked(200).forEach { chunk ->
            if (chunk.isEmpty()) return@forEach
            val placeholders = chunk.joinToString(",") { "?" }
            val selection = "$baseSelection AND ${MediaStore.Audio.Media._ID} IN ($placeholders)"
            val args = (listOf("Music/%") + chunk.map { it.toString() }).toTypedArray()

            resolver.query(collection, fullProjection, selection, args, null)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val trackCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
                val modifiedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)

                while (cursor.moveToNext()) {
                    processedItems++
                    val displayName = cursor.getString(nameCol)
                    if (displayName == null || !isSupported(displayName)) {
                        if (processedItems % 25 == 0 || processedItems == totalItems) {
                            onItemProgress((processedItems.toFloat() / totalItems).coerceIn(0f, 1f))
                        }
                        continue
                    }

                    val id = cursor.getLong(idCol)
                    val cacheKey = "$volume:$id"
                    val relativePath = cursor.getString(pathCol).orEmpty()
                    val dateModified = cursor.getLong(modifiedCol)
                    val fileSize = cursor.getLong(sizeCol)

                    // Android peut signaler des milliers de morceaux "modifiés" après un
                    // montage de SD sans modification réelle du contenu audio.
                    // Ne jamais rouvrir le fichier si son empreinte et son chemin sont identiques.
                    val cached = trackIndex[cacheKey]
                    if (cached != null &&
                        cached.dateModified == dateModified &&
                        cached.fileSize == fileSize &&
                        cached.displayName == displayName &&
                        cached.track.relativePath == relativePath
                    ) {
                        if (processedItems % 25 == 0 || processedItems == totalItems) {
                            onItemProgress((processedItems.toFloat() / totalItems).coerceIn(0f, 1f))
                        }
                        continue
                    }

                    val albumId = cursor.getLong(albumIdCol)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val mediaStoreAlbum = cleanTag(cursor.getString(albumCol))
                    val mediaStoreArtist = cleanTag(cursor.getString(artistCol))
                    val mediaStoreTitle = cleanTag(cursor.getString(titleCol))
                    val mediaStoreTrack = cursor.getInt(trackCol)
                    val mediaStoreDuration = cursor.getLong(durationCol).coerceAtLeast(0L)

                    // Réutilise les tags déjà lus si la taille et la date n'ont pas changé.
                    // Même en cas de déplacement/renommage, seules les infos de dossier sont recalculées.
                    val previousTags = tagCache[cacheKey]
                    val tags = if (previousTags != null &&
                        previousTags.dateModified == dateModified &&
                        previousTags.fileSize == fileSize
                    ) previousTags.tags else readTags(uri)
                    if (previousTags == null ||
                        previousTags.dateModified != dateModified ||
                        previousTags.fileSize != fileSize
                    ) {
                        tagCache[cacheKey] = CachedTagEntry(
                            dateModified = dateModified,
                            fileSize = fileSize,
                            tags = tags
                        )
                        tagCacheChanged = true
                    }

                    val rawAlbumTitle = tags.album
                        ?: mediaStoreAlbum
                        ?: albumFromPath(relativePath)
                        ?: "Album inconnu"
                    val albumTitle = stripDiscSuffix(rawAlbumTitle).ifBlank { rawAlbumTitle }
                    val artist = tags.artist ?: mediaStoreArtist ?: "Artiste inconnu"
                    val albumArtist = tags.albumArtist.orEmpty()
                    val composer = tags.composer.orEmpty()
                    val title = tags.title ?: mediaStoreTitle ?: displayName.substringBeforeLast('.')
                    val trackNumber = tags.trackNumber
                        ?: mediaStoreTrackNumber(mediaStoreTrack)
                        ?: leadingNumber(displayName)
                        ?: Int.MAX_VALUE
                    val discNumber = tags.discNumber
                        ?: mediaStoreDiscNumber(mediaStoreTrack)
                        ?: discFromPath(relativePath)
                        ?: 1
                    val durationMs = tags.durationMs?.takeIf { it > 0L } ?: mediaStoreDuration
                    val groupIdentity = when {
                        albumArtist.isNotBlank() -> normalizeKey(albumArtist)
                        albumFolderIdentity(relativePath).isNotBlank() -> albumFolderIdentity(relativePath)
                        else -> normalizeKey(artist)
                    }

                    val track = Track(
                        id = id,
                        uri = uri,
                        title = title,
                        artist = artist,
                        composer = composer,
                        albumTitle = albumTitle,
                        albumArtist = albumArtist,
                        albumId = albumId,
                        trackNumber = trackNumber,
                        discNumber = discNumber,
                        durationMs = durationMs,
                        relativePath = relativePath,
                        releaseDate = tags.releaseDate.orEmpty(),
                        genre = tags.genre.orEmpty()
                    )

                    trackIndex[cacheKey] = CachedIndexedTrack(
                        dateModified = dateModified,
                        fileSize = fileSize,
                        displayName = displayName,
                        track = track,
                        groupAlbumTitle = normalizeKey(albumTitle),
                        groupIdentity = groupIdentity
                    )
                    indexChanged = true
                    if (processedItems % 25 == 0 || processedItems == totalItems) {
                        onItemProgress((processedItems.toFloat() / totalItems).coerceIn(0f, 1f))
                    }
                }
            }
        }

        onItemProgress(1f)
        return indexChanged to tagCacheChanged
    }

    /**
     * Retire immédiatement d'un index local les titres supprimés via RoadPlayer.
     * Cela évite qu'une suppression réapparaisse à cause du cache lors du prochain ↻.
     */
    suspend fun forgetAlbumFromLocalIndex(album: Album) = withContext(Dispatchers.IO) {
        val uris = album.tracks.mapTo(hashSetOf()) { it.uri.toString() }
        if (uris.isEmpty()) return@withContext
        val keys = trackIndex.entries
            .filter { (_, entry) -> entry.track.uri.toString() in uris }
            .map { it.key }
        if (keys.isEmpty()) return@withContext
        keys.forEach { key ->
            trackIndex.remove(key)
            tagCache.remove(key)
        }
        saveTrackIndex()
        saveTagCache()
    }

    suspend fun loadAlbumsFromSdMusic(
        onProgress: suspend (Float) -> Unit = {},
        fastMetadataOnly: Boolean = false
    ): List<Album> = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val volumes = MediaStore.getExternalVolumeNames(context)
            .filter { it != MediaStore.VOLUME_EXTERNAL_PRIMARY }

        if (volumes.isEmpty()) {
            onProgress(1f)
            return@withContext emptyList()
        }
        onProgress(0.03f)

        var indexChanged = false
        var tagCacheChanged = false
        val seenTagCacheKeys = mutableSetOf<String>()
        val activePrefixes = volumes.map { "$it:" }

        // Retire de l'index les anciennes cartes/anciens volumes qui ne sont plus présents.
        val removedInactive = trackIndex.keys.filter { key -> activePrefixes.none { key.startsWith(it) } }
        if (removedInactive.isNotEmpty()) {
            removedInactive.forEach { key ->
                trackIndex.remove(key)
                tagCache.remove(key)
            }
            indexChanged = true
            tagCacheChanged = true
        }

        val lightProjection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.SIZE
        )

        val fullProjection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.SIZE
        )

        for ((volumeIndex, volume) in volumes.withIndex()) {
            val volumeBase = 0.06f + (volumeIndex.toFloat() / volumes.size.coerceAtLeast(1)) * 0.84f
            val volumeSpan = 0.84f / volumes.size.coerceAtLeast(1)
            onProgress(volumeBase)
            val prefix = "$volume:"
            val collection = MediaStore.Audio.Media.getContentUri(volume)
            val baseSelection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?"
            val baseArgs = arrayOf("Music/%")

            val generationBefore = mediaStoreGeneration(volume)
            val storedGeneration = scanStatePrefs.getLong(scanGenerationKey(volume), Long.MIN_VALUE)
            val indexReady = scanStatePrefs.getBoolean(scanReadyKey(volume), false)

            // Cas idéal : aucun changement MediaStore depuis le dernier scan.
            // On ne touche pas du tout à la carte SD.
            if (indexReady && generationBefore != null && generationBefore == storedGeneration) {
                trackIndex.keys.asSequence()
                    .filter { it.startsWith(prefix) }
                    .forEach { seenTagCacheKeys += it }
                onProgress(volumeBase + volumeSpan)
                continue
            }

            val currentFiles = LinkedHashMap<Long, FileFingerprint>()
            var lightQuerySucceeded = false

            resolver.query(
                collection,
                lightProjection,
                baseSelection,
                baseArgs,
                null
            )?.use { cursor ->
                lightQuerySucceeded = true
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
                val modifiedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)

                val totalRows = cursor.count.coerceAtLeast(1)
                var rowsRead = 0
                while (cursor.moveToNext()) {
                    val displayName = cursor.getString(nameCol)
                    if (displayName != null && isSupported(displayName)) {
                        val id = cursor.getLong(idCol)
                        currentFiles[id] = FileFingerprint(
                            displayName = displayName,
                            relativePath = cursor.getString(pathCol).orEmpty(),
                            dateModified = cursor.getLong(modifiedCol),
                            fileSize = cursor.getLong(sizeCol)
                        )
                    }
                    rowsRead++
                    if (rowsRead == totalRows || rowsRead % 100 == 0) {
                        onProgress(volumeBase + volumeSpan * 0.38f * (rowsRead.toFloat() / totalRows))
                    }
                }
            }

            if (!lightQuerySucceeded) {
                // Si MediaStore refuse momentanément la requête, on garde l'index existant
                // au lieu de vider la bibliothèque.
                trackIndex.keys.asSequence()
                    .filter { it.startsWith(prefix) }
                    .forEach { seenTagCacheKeys += it }
                continue
            }

            val currentKeys = currentFiles.keys.mapTo(mutableSetOf()) { "$volume:$it" }
            val oldKeys = trackIndex.keys.filterTo(mutableSetOf()) { it.startsWith(prefix) }

            // Fichiers supprimés ou déplacés hors de Music/.
            val staleKeys = oldKeys - currentKeys
            if (staleKeys.isNotEmpty()) {
                staleKeys.forEach { key ->
                    trackIndex.remove(key)
                    if (tagCache.remove(key) != null) tagCacheChanged = true
                }
                indexChanged = true
            }

            val changedIds = currentFiles.entries.mapNotNull { (id, fingerprint) ->
                val key = "$volume:$id"
                val cached = trackIndex[key]
                if (cached == null ||
                    cached.dateModified != fingerprint.dateModified ||
                    cached.fileSize != fingerprint.fileSize ||
                    cached.displayName != fingerprint.displayName ||
                    cached.track.relativePath != fingerprint.relativePath
                ) id else null
            }

            // Relit uniquement les nouveaux morceaux / morceaux réellement modifiés.
            val changedChunks = changedIds.chunked(200)
            changedChunks.forEachIndexed { chunkIndex, chunk ->
                if (chunk.isEmpty()) return@forEachIndexed
                val placeholders = chunk.joinToString(",") { "?" }
                val selection = "$baseSelection AND ${MediaStore.Audio.Media._ID} IN ($placeholders)"
                val args = (listOf("Music/%") + chunk.map { it.toString() }).toTypedArray()

                resolver.query(collection, fullProjection, selection, args, null)?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
                    val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                    val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                    val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                    val trackCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
                    val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                    val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                    val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
                    val modifiedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
                    val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)

                    while (cursor.moveToNext()) {
                        val displayName = cursor.getString(nameCol) ?: continue
                        if (!isSupported(displayName)) continue

                        val id = cursor.getLong(idCol)
                        val cacheKey = "$volume:$id"
                        val albumId = cursor.getLong(albumIdCol)
                        val uri = ContentUris.withAppendedId(collection, id)
                        val relativePath = cursor.getString(pathCol).orEmpty()
                        val mediaStoreAlbum = cleanTag(cursor.getString(albumCol))
                        val mediaStoreArtist = cleanTag(cursor.getString(artistCol))
                        val mediaStoreTitle = cleanTag(cursor.getString(titleCol))
                        val mediaStoreTrack = cursor.getInt(trackCol)
                        val mediaStoreDuration = cursor.getLong(durationCol).coerceAtLeast(0L)
                        val dateModified = cursor.getLong(modifiedCol)
                        val fileSize = cursor.getLong(sizeCol)

                        val cachedTags = tagCache[cacheKey]
                        val tags = if (cachedTags != null &&
                            cachedTags.dateModified == dateModified &&
                            cachedTags.fileSize == fileSize
                        ) {
                            cachedTags.tags
                        } else if (fastMetadataOnly) {
                            // Premier index rapide : pas de lecture MP3/FLAC individuelle.
                            // Le scan manuel pourra enrichir les tags ultérieurement.
                            AudioTags()
                        } else {
                            readTags(uri).also { fresh ->
                                tagCache[cacheKey] = CachedTagEntry(
                                    dateModified = dateModified,
                                    fileSize = fileSize,
                                    tags = fresh
                                )
                                tagCacheChanged = true
                            }
                        }

                        val rawAlbumTitle = tags.album
                            ?: mediaStoreAlbum
                            ?: albumFromPath(relativePath)
                            ?: "Album inconnu"
                        val albumTitle = stripDiscSuffix(rawAlbumTitle).ifBlank { rawAlbumTitle }

                        val artist = tags.artist
                            ?: mediaStoreArtist
                            ?: "Artiste inconnu"
                        val albumArtist = tags.albumArtist.orEmpty()
                        val composer = tags.composer.orEmpty()

                        val title = tags.title
                            ?: mediaStoreTitle
                            ?: displayName.substringBeforeLast('.')

                        val trackNumber = tags.trackNumber
                            ?: mediaStoreTrackNumber(mediaStoreTrack)
                            ?: leadingNumber(displayName)
                            ?: Int.MAX_VALUE

                        val discNumber = tags.discNumber
                            ?: mediaStoreDiscNumber(mediaStoreTrack)
                            ?: discFromPath(relativePath)
                            ?: 1

                        val durationMs = tags.durationMs
                            ?.takeIf { it > 0L }
                            ?: mediaStoreDuration

                        val groupIdentity = when {
                            albumArtist.isNotBlank() -> normalizeKey(albumArtist)
                            albumFolderIdentity(relativePath).isNotBlank() -> albumFolderIdentity(relativePath)
                            else -> normalizeKey(artist)
                        }

                        val track = Track(
                            id = id,
                            uri = uri,
                            title = title,
                            artist = artist,
                            composer = composer,
                            albumTitle = albumTitle,
                            albumArtist = albumArtist,
                            albumId = albumId,
                            trackNumber = trackNumber,
                            discNumber = discNumber,
                            durationMs = durationMs,
                            relativePath = relativePath,
                            releaseDate = tags.releaseDate.orEmpty(),
                            genre = tags.genre.orEmpty()
                        )

                        trackIndex[cacheKey] = CachedIndexedTrack(
                            // Marque un morceau non enrichi pour le prochain scan manuel.
                            dateModified = if (fastMetadataOnly && cachedTags == null) Long.MIN_VALUE else dateModified,
                            fileSize = fileSize,
                            displayName = displayName,
                            track = track,
                            groupAlbumTitle = normalizeKey(albumTitle),
                            groupIdentity = groupIdentity
                        )
                        indexChanged = true
                    }
                }
                val chunkFraction = (chunkIndex + 1).toFloat() / changedChunks.size.coerceAtLeast(1)
                onProgress(volumeBase + volumeSpan * (0.42f + 0.48f * chunkFraction))
            }

            if (changedChunks.isEmpty()) onProgress(volumeBase + volumeSpan * 0.90f)
            currentKeys.forEach { seenTagCacheKeys += it }

            // On enregistre la génération APRES la mise à jour de l'index.
            // Si MediaStore change encore pendant le scan, le prochain ↻ le verra.
            mediaStoreGeneration(volume)?.let { generationAfter ->
                scanStatePrefs.edit()
                    .putLong(scanGenerationKey(volume), generationAfter)
                    // L'index rapide est jouable, mais le scan manuel doit pouvoir
                    // enrichir les tags même si MediaStore n'a pas changé.
                    .putBoolean(scanReadyKey(volume), !fastMetadataOnly)
                    .apply()
            } ?: scanStatePrefs.edit()
                .putBoolean(scanReadyKey(volume), !fastMetadataOnly)
                .apply()
            onProgress(volumeBase + volumeSpan)
        }

        onProgress(0.92f)
        // Garde uniquement les tags correspondant à des morceaux encore présents.
        val staleTagKeys = tagCache.keys.filter { it !in seenTagCacheKeys }
        if (staleTagKeys.isNotEmpty()) {
            staleTagKeys.forEach { tagCache.remove(it) }
            tagCacheChanged = true
        }

        if (indexChanged) saveTrackIndex()
        if (tagCacheChanged) saveTagCache()

        val taggedTracks = trackIndex.entries.asSequence()
            .filter { (key, _) -> activePrefixes.any { key.startsWith(it) } }
            .map { (_, cached) ->
                TaggedTrack(
                    track = cached.track,
                    groupAlbumTitle = cached.groupAlbumTitle,
                    groupIdentity = cached.groupIdentity
                )
            }
            .toList()

        onProgress(0.97f)
        val result = buildAlbumsFromTaggedTracks(taggedTracks)
        onProgress(1f)
        result
    }

    private fun buildAlbumsFromTaggedTracks(taggedTracks: List<TaggedTrack>): List<Album> {
        val baseAlbums = taggedTracks
            .groupBy { "${it.groupAlbumTitle}|${it.groupIdentity}" }
            .map { (key, items) ->
                val tracks = items.map { it.track }
                    .sortedWith(
                        compareBy<Track> { it.discNumber }
                            .thenBy { it.trackNumber }
                            .thenBy { it.title.lowercase(Locale.ROOT) }
                    )

                val title = mostCommon(
                    tracks.map { it.albumTitle }.filter { it.isNotBlank() }
                ) ?: "Album inconnu"

                val explicitAlbumArtists = tracks.map { it.albumArtist }
                    .filter { it.isNotBlank() && !isUnknownTag(it) }
                    .distinctBy { normalizeKey(it) }

                val trackArtists = tracks.map { it.artist }
                    .filter { it.isNotBlank() && !isUnknownTag(it) }
                    .distinctBy { normalizeKey(it) }

                val albumArtist = when {
                    explicitAlbumArtists.size == 1 -> explicitAlbumArtists.first()
                    trackArtists.size == 1 -> trackArtists.first()
                    trackArtists.size > 1 -> "Artistes divers"
                    else -> "Artiste inconnu"
                }

                val releaseDate = mostCommon(
                    tracks.map { it.releaseDate }.filter { it.isNotBlank() }
                ).orEmpty()

                val taggedGenre = mostCommon(
                    tracks.map { normalizeGenreLabel(it.genre) }.filter { it.isNotBlank() }
                ).orEmpty()
                val genre = when {
                    isVariousArtist(albumArtist) -> "Soundtracks"
                    taggedGenre.isNotBlank() -> taggedGenre
                    else -> "Autres"
                }

                applyAlbumMetadataOverride(
                    Album(
                        key = key,
                        title = title,
                        artist = albumArtist,
                        tracks = tracks,
                        releaseDate = releaseDate,
                        genre = genre
                    )
                )
            }
            .filterNot { isAlbumHidden(it.key) }

        return applyAlbumMerges(baseAlbums)
            .filterNot { isAlbumHidden(it.key) }
            .sortedWith(
                compareBy<Album> { normalizeKey(it.title) }
                    .thenBy { normalizeKey(it.artist) }
            )
    }


    private fun isVariousArtist(value: String): Boolean {
        val key = normalizeKey(value)
        return key == "various artists" || key == "various artist" ||
            key == "artistes divers" || key == "artiste divers" ||
            key == "v a" || key == "va"
    }

    private fun normalizeGenreLabel(raw: String): String {
        val value = raw.trim()
            .substringBefore(';')
            .substringBefore('/')
            .trim()
        if (value.isBlank()) return ""
        val key = value.lowercase(Locale.ROOT)
        return when {
            key in setOf("soundtrack", "soundtracks", "ost", "original soundtrack", "film soundtrack") -> "Soundtracks"
            key in setOf("podcast", "podcasts", "balado", "balados") -> "Podcast"
            key == "rock" -> "Rock"
            key == "pop" -> "Pop"
            key == "jazz" -> "Jazz"
            key == "blues" -> "Blues"
            key == "classical" || key == "classique" -> "Classique"
            key == "electronic" || key == "electronica" || key == "électronique" -> "Électronique"
            key == "hip-hop" || key == "hip hop" || key == "rap" -> "Hip-Hop / Rap"
            key == "r&b" || key == "rnb" || key == "rhythm and blues" -> "R&B"
            key == "reggae" -> "Reggae"
            key == "country" -> "Country"
            key == "metal" || key == "heavy metal" -> "Metal"
            key == "soul" -> "Soul"
            key == "funk" -> "Funk"
            else -> value.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
        }
    }

    private fun mediaStoreGeneration(volume: String): Long? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return runCatching { MediaStore.getGeneration(context, volume) }.getOrNull()
    }

    private fun scanGenerationKey(volume: String): String = "generation.$volume"
    private fun scanReadyKey(volume: String): String = "ready.$volume"

    suspend fun saveAlbumMetadata(
        album: Album,
        title: String,
        artist: String,
        releaseDate: String
    ): Album = withContext(Dispatchers.IO) {
        val cleanTitle = title.trim().replace(Regex("\\s+"), " ").ifBlank { album.title }
        val cleanArtist = artist.trim().replace(Regex("\\s+"), " ").ifBlank { album.artist }
        val cleanDate = releaseDate.trim().replace(Regex("\\s+"), " ")

        albumMetadataPrefs.edit()
            .putString(metadataKey(album.key, "title"), cleanTitle)
            .putString(metadataKey(album.key, "artist"), cleanArtist)
            .putString(metadataKey(album.key, "date"), cleanDate)
            .apply()

        // Si l'ancien titre/artiste avait produit une pochette automatique erronée,
        // on force une nouvelle recherche au prochain affichage. Une pochette choisie
        // manuellement n'est jamais supprimée ici.
        runCatching { coverCacheFile(album).delete() }
        failedOnlineLookups.remove(album.key)

        album.copy(
            title = cleanTitle,
            artist = cleanArtist,
            releaseDate = cleanDate
        )
    }

    suspend fun clearAlbumMetadata(album: Album): Album = withContext(Dispatchers.IO) {
        albumMetadataPrefs.edit()
            .remove(metadataKey(album.key, "title"))
            .remove(metadataKey(album.key, "artist"))
            .remove(metadataKey(album.key, "date"))
            .apply()
        runCatching { coverCacheFile(album).delete() }
        failedOnlineLookups.remove(album.key)
        // Le rechargement de la bibliothèque restitue ensuite les tags/dossiers d'origine.
        album
    }

    private fun applyAlbumMetadataOverride(album: Album): Album {
        val title = albumMetadataPrefs
            .getString(metadataKey(album.key, "title"), null)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: album.title
        val artist = albumMetadataPrefs
            .getString(metadataKey(album.key, "artist"), null)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: album.artist
        val date = if (albumMetadataPrefs.contains(metadataKey(album.key, "date"))) {
            albumMetadataPrefs.getString(metadataKey(album.key, "date"), "").orEmpty().trim()
        } else {
            album.releaseDate
        }
        return album.copy(title = title, artist = artist, releaseDate = date)
    }

    private fun metadataKey(albumKey: String, field: String): String =
        "${sha256(albumKey.toByteArray(Charsets.UTF_8))}.$field"

    private data class MergeDefinition(
        val id: String,
        val memberKeys: List<String>
    )

    private fun loadMergeDefinitions(): List<MergeDefinition> {
        val ids = mergePrefs.getStringSet(MERGE_GROUP_IDS_KEY, emptySet()).orEmpty()
        return ids.mapNotNull { id ->
            val raw = mergePrefs.getString(mergeMembersKey(id), null) ?: return@mapNotNull null
            val members = runCatching {
                val array = JSONArray(raw)
                buildList {
                    for (i in 0 until array.length()) {
                        array.optString(i).trim().takeIf { it.isNotBlank() }?.let(::add)
                    }
                }
            }.getOrDefault(emptyList())
            members.distinct().takeIf { it.size in 2..3 }?.let { MergeDefinition(id, it) }
        }
    }

    private fun applyAlbumMerges(albums: List<Album>): List<Album> {
        if (albums.isEmpty()) return albums
        val byKey = albums.associateBy { it.key }
        val consumed = mutableSetOf<String>()
        val mergedAlbums = mutableListOf<Album>()

        for (definition in loadMergeDefinitions()) {
            val members = definition.memberKeys.mapNotNull { byKey[it] }
            if (members.size < 2) continue
            if (members.any { member -> member.key in consumed }) continue

            val base = members.first()
            val merged = applyAlbumMetadataOverride(
                Album(
                    key = mergedAlbumKey(definition.id),
                    title = base.title,
                    artist = base.artist,
                    releaseDate = base.releaseDate,
                    genre = base.genre,
                    tracks = members.flatMap { it.tracks },
                    sourceAlbumKeys = members.map { it.key }
                )
            )
            mergedAlbums += merged
            consumed += members.map { it.key }
        }

        return albums.filterNot { it.key in consumed } + mergedAlbums
    }

    suspend fun mergeAlbums(base: Album, others: List<Album>): String? = withContext(Dispatchers.IO) {
        val orderedKeys = buildList {
            addAll(if (base.sourceAlbumKeys.isNotEmpty()) base.sourceAlbumKeys else listOf(base.key))
            for (album in others) {
                addAll(if (album.sourceAlbumKeys.isNotEmpty()) album.sourceAlbumKeys else listOf(album.key))
            }
        }.distinct()

        if (orderedKeys.size !in 2..3) return@withContext null

        val definitions = loadMergeDefinitions()
        val intersectingIds = definitions
            .filter { definition -> definition.memberKeys.any { it in orderedKeys } }
            .map { it.id }
            .toSet()

        val newId = sha256(orderedKeys.joinToString("\n").toByteArray(Charsets.UTF_8)).take(24)
        val ids = mergePrefs.getStringSet(MERGE_GROUP_IDS_KEY, emptySet()).orEmpty().toMutableSet()
        ids.removeAll(intersectingIds)
        ids.add(newId)

        val editor = mergePrefs.edit().putStringSet(MERGE_GROUP_IDS_KEY, ids)
        intersectingIds.forEach { id -> editor.remove(mergeMembersKey(id)) }
        val array = JSONArray()
        orderedKeys.forEach { array.put(it) }
        editor.putString(mergeMembersKey(newId), array.toString()).apply()

        // Conserver la pochette personnalisée/automatique du premier album comme base visuelle.
        val mergedKey = mergedAlbumKey(newId)
        copyArtworkForMergedAlbum(base, mergedKey)
        failedOnlineLookups.remove(mergedKey)
        mergedKey
    }

    suspend fun unmergeAlbum(album: Album): Boolean = withContext(Dispatchers.IO) {
        val id = album.key.removePrefix("merged:").takeIf { album.key.startsWith("merged:") }
            ?: return@withContext false
        val ids = mergePrefs.getStringSet(MERGE_GROUP_IDS_KEY, emptySet()).orEmpty().toMutableSet()
        val existed = ids.remove(id)
        mergePrefs.edit()
            .putStringSet(MERGE_GROUP_IDS_KEY, ids)
            .remove(mergeMembersKey(id))
            .apply()

        if (existed) {
            albumMetadataPrefs.edit()
                .remove(metadataKey(album.key, "title"))
                .remove(metadataKey(album.key, "artist"))
                .remove(metadataKey(album.key, "date"))
                .apply()
            runCatching { customCoverFile(album).delete() }
            runCatching { coverCacheFile(album).delete() }
            failedOnlineLookups.remove(album.key)
        }
        existed
    }

    private fun copyArtworkForMergedAlbum(base: Album, mergedKey: String) {
        val mergedAlbum = Album(
            key = mergedKey,
            title = base.title,
            artist = base.artist,
            tracks = base.tracks,
            releaseDate = base.releaseDate,
            genre = base.genre
        )
        val customSource = customCoverFile(base)
        if (customSource.isFile) {
            runCatching { customSource.copyTo(customCoverFile(mergedAlbum), overwrite = true) }
            return
        }
        val cacheSource = coverCacheFile(base)
        if (cacheSource.isFile) {
            runCatching { cacheSource.copyTo(coverCacheFile(mergedAlbum), overwrite = true) }
        }
    }

    private fun mergedAlbumKey(id: String): String = "merged:$id"
    private fun mergeMembersKey(id: String): String = "merge.$id.members"

    suspend fun hideAlbum(album: Album) = withContext(Dispatchers.IO) {
        hiddenAlbumsPrefs.edit()
            .putBoolean(hiddenAlbumKey(album.key), true)
            .apply()
    }

    suspend fun listPlaylists(): List<PlaylistSummary> = withContext(Dispatchers.IO) {
        val names = playlistPrefs.getStringSet(PLAYLIST_NAMES_KEY, emptySet()).orEmpty()
        names
            .map { name ->
                PlaylistSummary(
                    name = name,
                    count = playlistPrefs.getStringSet(playlistAlbumKey(name), emptySet()).orEmpty().size
                )
            }
            .sortedBy { it.name.lowercase(Locale.ROOT) }
    }

    suspend fun addAlbumToPlaylist(album: Album, playlistName: String): Boolean = withContext(Dispatchers.IO) {
        val cleanName = playlistName.trim()
        if (cleanName.isBlank()) return@withContext false

        val names = playlistPrefs.getStringSet(PLAYLIST_NAMES_KEY, emptySet()).orEmpty().toMutableSet()
        names.add(cleanName)

        val albumEntries = playlistPrefs.getStringSet(playlistAlbumKey(cleanName), emptySet()).orEmpty().toMutableSet()
        albumEntries.add(album.key)

        playlistPrefs.edit()
            .putStringSet(PLAYLIST_NAMES_KEY, names)
            .putStringSet(playlistAlbumKey(cleanName), albumEntries)
            .apply()
        true
    }

    private fun isAlbumHidden(albumKey: String): Boolean =
        hiddenAlbumsPrefs.getBoolean(hiddenAlbumKey(albumKey), false)

    private fun hiddenAlbumKey(albumKey: String): String =
        "hidden.${sha256(albumKey.toByteArray(Charsets.UTF_8))}"

    private fun playlistAlbumKey(name: String): String =
        "playlist.${sha256(name.trim().lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8))}.albums"

    /**
     * Pochette, dans cet ordre :
     * 1. cache persistant RoadPlayer (pochettes déjà récupérées en ligne)
     * 2. image intégrée dans un MP3/FLAC
     * 3. vignette MediaStore Android
     * 4. ancien fournisseur album-art Android via ALBUM_ID
     * 5. Internet : iTunes (FR/US/GB), Deezer puis MusicBrainz/Cover Art Archive, avec cache local
     */
    suspend fun albumArtworkBitmap(
        album: Album,
        sizePx: Int = 640,
        allowNetwork: Boolean = true
    ): Bitmap? = withContext(Dispatchers.IO) {
        customArtworkInternal(album, sizePx)?.let { return@withContext it }
        cachedArtworkInternal(album, sizePx)?.let { return@withContext it }

        for (track in album.tracks) {
            val bytes = embeddedArtworkInternal(track.uri) ?: continue
            decodeBitmap(bytes, sizePx)?.let { return@withContext it }
        }

        for (track in album.tracks) {
            mediaStoreArtworkInternal(track.uri, sizePx)?.let { return@withContext it }
        }

        album.tracks.asSequence()
            .map { it.albumId }
            .filter { it > 0L }
            .distinct()
            .forEach { albumId ->
                legacyAlbumArtworkInternal(albumId, sizePx)?.let { return@withContext it }
            }

        if (!allowNetwork || failedOnlineLookups.contains(album.key)) {
            return@withContext null
        }

        onlineCoverSemaphore.withPermit {
            cachedArtworkInternal(album, sizePx)?.let { return@withPermit it }

            val bytes = findOnlineArtworkBytes(album)
            if (bytes == null) {
                failedOnlineLookups.add(album.key)
                return@withPermit null
            }

            saveArtworkCache(album, bytes)
            decodeBitmap(bytes, sizePx)
        }
    }

    suspend fun albumArtworkBytes(album: Album): ByteArray? = withContext(Dispatchers.IO) {
        customArtworkBytesInternal(album)?.let { return@withContext it }
        cachedArtworkBytesInternal(album)?.let { return@withContext it }

        for (track in album.tracks) {
            embeddedArtworkInternal(track.uri)?.let { return@withContext it }
        }

        // Ne bloque jamais le démarrage d'un album avec une recherche Internet.
        val bitmap = albumArtworkBitmap(album, 900, allowNetwork = false)
            ?: return@withContext null
        val output = ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)) {
            return@withContext null
        }
        output.toByteArray()
    }

    suspend fun saveCustomArtwork(album: Album, bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        if (bytes.isEmpty() || decodeBitmap(bytes, 64) == null) return@withContext false
        val success = writeArtworkFile(customCoverFile(album), bytes)
        if (success) failedOnlineLookups.remove(album.key)
        success
    }

    suspend fun saveCustomArtwork(album: Album, uri: Uri): Boolean = withContext(Dispatchers.IO) {
        val bytes = try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(32 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > 12L * 1024L * 1024L) return@withContext false
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
        } catch (_: Exception) {
            null
        } ?: return@withContext false

        saveCustomArtwork(album, bytes)
    }

    /**
     * Colle directement une pochette depuis le presse-papiers Android.
     * Compatible avec :
     * - une image copiée (URI image synchronisée par Lien avec Windows / Mobile connecté) ;
     * - un lien ou un ID texte déjà pris en charge par artworkFromReference().
     */
    suspend fun saveCustomArtworkFromClipboard(album: Album): Boolean {
        // Mobile connecté synchronise parfois le presse-papiers Windows -> Android
        // avec quelques centaines de millisecondes de retard. Si on lit tout de suite,
        // Android peut donc encore renvoyer l'ancienne image (effet « un collage en retard »).
        // On attend la dernière mise à jour uniquement quand le presse-papiers Android
        // paraît ancien ; s'il vient déjà d'être mis à jour, le collage reste immédiat.
        val clip = awaitFreshClipboardClip() ?: return false
        val success = withContext(Dispatchers.IO) {
            saveCustomArtworkFromClip(album, clip)
        }
        if (success) {
            val signature = clipSignature(clip)
            if (signature.isNotBlank()) {
                context.getSharedPreferences("roadplayer_clipboard", Context.MODE_PRIVATE)
                    .edit()
                    .putString("last_used_signature", signature)
                    .apply()
            }
        }
        return success
    }

    private data class ClipboardSnapshot(
        val clip: ClipData?,
        val signature: String
    )

    private suspend fun awaitFreshClipboardClip(): ClipData? = withContext(Dispatchers.Main) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return@withContext null
        val prefs = context.getSharedPreferences("roadplayer_clipboard", Context.MODE_PRIVATE)
        val lastUsedSignature = prefs.getString("last_used_signature", null)

        val first = clipboardSnapshot(clipboard)
        if (first.clip == null) return@withContext null

        // Lien avec Windows peut mettre un court instant avant de pousser le nouveau
        // presse-papiers sur Android. On laisse d'abord 650 ms au contenu pour arriver.
        delay(650L)
        var current = clipboardSnapshot(clipboard)

        // Si le contenu a changé pendant ces 650 ms, on prend forcément le plus récent.
        if (current.signature != first.signature && current.clip != null) {
            delay(150L)
            return@withContext clipboard.primaryClip ?: current.clip
        }

        // Si le contenu visible est exactement celui du dernier collage réussi, il est
        // très probablement encore ancien. On attend jusqu'à 3 secondes sa mise à jour.
        if (lastUsedSignature != null && current.signature == lastUsedSignature) {
            val deadline = System.currentTimeMillis() + 3000L
            while (System.currentTimeMillis() < deadline) {
                delay(120L)
                val next = clipboardSnapshot(clipboard)
                if (next.signature != current.signature && next.clip != null) {
                    delay(150L)
                    return@withContext clipboard.primaryClip ?: next.clip
                }
                current = next
            }
        }

        // Aucun nouveau contenu détecté : utiliser ce que le téléphone expose maintenant.
        current.clip ?: first.clip
    }

    private fun clipboardSnapshot(clipboard: ClipboardManager): ClipboardSnapshot {
        val clip = clipboard.primaryClip
        return ClipboardSnapshot(clip, clipSignature(clip))
    }

    private fun clipSignature(clip: ClipData?): String {
        if (clip == null) return ""
        return buildString {
            append('#').append(clip.itemCount)
            for (i in 0 until clip.itemCount) {
                val item = clip.getItemAt(i)
                append('|').append(item.uri?.toString().orEmpty())
                append('|').append(item.intent?.dataString.orEmpty())
                append('|').append(item.text?.toString().orEmpty())
                append('|').append(item.htmlText.orEmpty())
            }
        }
    }

    private suspend fun saveCustomArtworkFromClip(album: Album, clip: ClipData): Boolean {
        for (index in 0 until clip.itemCount) {
            val item = clip.getItemAt(index)

            // 1) URI Android classique (image copiée, fichier, contenu partagé...).
            val uris = listOfNotNull(item.uri, item.intent?.data).distinct()
            for (uri in uris) {
                if (saveCustomArtwork(album, uri)) return true
            }

            // 2) Certains navigateurs / Mobile connecté transmettent l'image sous
            // forme de HTML plutôt que comme URI. On récupère alors src/href.
            val candidates = linkedSetOf<String>()
            item.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let(candidates::add)
            item.htmlText?.trim()?.takeIf { it.isNotBlank() }?.let { html ->
                candidates.add(html)
                extractUrlsFromClipboardHtml(html).forEach(candidates::add)
            }
            item.intent?.dataString?.trim()?.takeIf { it.isNotBlank() }?.let(candidates::add)
            item.uri?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let(candidates::add)
            runCatching { item.coerceToText(context)?.toString()?.trim().orEmpty() }
                .getOrDefault("")
                .takeIf { it.isNotBlank() }
                ?.let(candidates::add)

            // 3) Texte/HTML : URL d'image, page web, identifiant iTunes/Deezer/etc.
            for (candidate in candidates) {
                decodeDataImage(candidate)?.let { bytes ->
                    if (saveCustomArtwork(album, bytes)) return true
                }

                // Si le texte contient une URL au milieu d'autre chose, on la teste aussi.
                val refs = linkedSetOf(candidate)
                extractUrlsFromText(candidate).forEach(refs::add)
                for (ref in refs) {
                    val suggestion = artworkFromReference(album, ref)
                    if (suggestion != null && saveCustomArtwork(album, suggestion.bytes)) {
                        return true
                    }
                }
            }
        }
        return false
    }

    private fun extractUrlsFromClipboardHtml(html: String): List<String> {
        val results = linkedSetOf<String>()
        val patterns = listOf(
            Regex("(?is)<img[^>]+src=[\"']([^\"']+)[\"']"),
            Regex("(?is)<a[^>]+href=[\"']([^\"']+)[\"']")
        )
        patterns.forEach { regex ->
            regex.findAll(html).forEach { match ->
                match.groupValues.getOrNull(1)
                    ?.replace("&amp;", "&")
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?.let(results::add)
            }
        }
        return results.toList()
    }

    private fun extractUrlsFromText(text: String): List<String> {
        return Regex("https?://[^\\s\"'<>]+", RegexOption.IGNORE_CASE)
            .findAll(text)
            .map { it.value.trimEnd('.', ',', ';', ')', ']', '}') }
            .distinct()
            .toList()
    }

    private fun decodeDataImage(value: String): ByteArray? {
        val trimmed = value.trim()
        if (!trimmed.startsWith("data:image/", ignoreCase = true)) return null
        val comma = trimmed.indexOf(',')
        if (comma <= 0) return null
        val header = trimmed.substring(0, comma)
        if (!header.contains(";base64", ignoreCase = true)) return null
        return runCatching { Base64.decode(trimmed.substring(comma + 1), Base64.DEFAULT) }.getOrNull()
    }

    suspend fun clearCustomArtwork(album: Album): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val file = customCoverFile(album)
            !file.exists() || file.delete()
        }.getOrDefault(false)
    }

    suspend fun artworkSuggestions(album: Album, limit: Int = 8): List<ArtworkSuggestion> =
        withContext(Dispatchers.IO) {
            val maxResults = limit.coerceIn(1, 12)
            val results = mutableListOf<ArtworkSuggestion>()
            val seenHashes = HashSet<String>()
            val seenUrls = HashSet<String>()

            // Toujours proposer d'abord la meilleure pochette automatique déjà connue,
            // si elle existe. Cela évite un écran vide lorsque les services externes
            // sont momentanément indisponibles.
            automaticArtworkBytesForSuggestion(album)?.let { bytes ->
                val hash = sha256(bytes)
                if (seenHashes.add(hash)) {
                    results += ArtworkSuggestion(
                        id = hash,
                        source = "MerylCarPlayer",
                        albumTitle = album.title,
                        artist = album.artist,
                        bytes = bytes
                    )
                }
            }

            val candidates = mutableListOf<SuggestionCandidate>()
            candidates += collectItunesSuggestionCandidates(album)
            candidates += collectDeezerSuggestionCandidates(album)
            candidates += collectMusicBrainzSuggestionCandidates(album)

            // Pour un choix manuel, on reste volontairement plus permissif que la
            // recherche automatique : l'utilisateur voit les images et décide.
            for (candidate in candidates.sortedByDescending { it.score }) {
                if (results.size >= maxResults) break
                if (!seenUrls.add(candidate.url)) continue
                val bytes = downloadValidArtwork(candidate.url) ?: continue
                val hash = sha256(bytes)
                if (!seenHashes.add(hash)) continue
                results += ArtworkSuggestion(
                    id = hash,
                    source = candidate.source,
                    albumTitle = candidate.albumTitle,
                    artist = candidate.artist,
                    bytes = bytes
                )
            }
            results
        }

    /**
     * Permet de forcer une pochette à partir d'un identifiant ou d'un lien copié.
     * Formats reconnus :
     * - itunes:123456 / apple:123456 / lien Apple Music ou iTunes
     * - deezer:123456 / lien Deezer
     * - mb:<UUID> / musicbrainz:<UUID> / lien MusicBrainz
     * - musicboard:<id> / lien Musicboard
     * - URL d'une image ou d'une page contenant og:image / cover_large
     * - identifiant numérique seul : essaie iTunes, Deezer puis Musicboard
     */
    suspend fun artworkFromReference(album: Album, rawReference: String): ArtworkSuggestion? =
        withContext(Dispatchers.IO) {
            val reference = rawReference.trim()
            if (reference.isBlank()) return@withContext null

            val resolved = resolveArtworkReference(reference) ?: return@withContext null
            val hash = sha256(resolved.bytes)
            ArtworkSuggestion(
                id = hash,
                source = resolved.source,
                albumTitle = album.title,
                artist = album.artist,
                bytes = resolved.bytes
            )
        }

    private data class ResolvedReferenceArtwork(
        val source: String,
        val bytes: ByteArray
    )

    private fun resolveArtworkReference(reference: String): ResolvedReferenceArtwork? {
        val value = reference.trim()
        val lower = value.lowercase(Locale.ROOT)

        // Préfixes explicites : ils évitent toute ambiguïté entre plusieurs services.
        Regex("(?i)^(?:itunes|apple)\\s*:\\s*(\\d+)$").find(value)?.groupValues?.getOrNull(1)?.let { id ->
            artworkFromItunesId(id)?.let { return ResolvedReferenceArtwork("Apple/iTunes", it) }
        }
        Regex("(?i)^deezer\\s*:\\s*(\\d+)$").find(value)?.groupValues?.getOrNull(1)?.let { id ->
            artworkFromDeezerId(id)?.let { return ResolvedReferenceArtwork("Deezer", it) }
        }
        Regex("(?i)^(?:mb|musicbrainz)\\s*:\\s*([0-9a-f-]{36})$").find(value)?.groupValues?.getOrNull(1)?.let { id ->
            artworkFromMusicBrainzId(id)?.let { return ResolvedReferenceArtwork("MusicBrainz", it) }
        }
        Regex("(?i)^musicboard\\s*:\\s*(.+)$").find(value)?.groupValues?.getOrNull(1)?.trim()?.let { id ->
            artworkFromMusicboardId(id)?.let { return ResolvedReferenceArtwork("Musicboard", it) }
        }

        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            // On essaie TOUJOURS d'abord le lien comme image directe, même sans
            // extension .jpg/.png. C'est indispensable pour les miniatures Google
            // (encrypted-tbn*.gstatic.com/images?q=tbn:...) et de nombreux CDN.
            // Si l'URL pointe vers une page HTML, BitmapFactory la rejettera et on
            // continuera ensuite avec l'analyse de la page web.
            downloadValidArtwork(value)?.let {
                return ResolvedReferenceArtwork("Lien direct", it)
            }

            val host = runCatching { URL(value).host.lowercase(Locale.ROOT) }.getOrDefault("")

            if (host.contains("apple.com") || host.contains("itunes.apple.com")) {
                extractAppleId(value)?.let { id ->
                    artworkFromItunesId(id)?.let { return ResolvedReferenceArtwork("Apple/iTunes", it) }
                }
            }
            if (host.contains("deezer.com")) {
                Regex("(?i)/album/(\\d+)").find(value)?.groupValues?.getOrNull(1)?.let { id ->
                    artworkFromDeezerId(id)?.let { return ResolvedReferenceArtwork("Deezer", it) }
                }
            }
            if (host.contains("musicbrainz.org")) {
                Regex("(?i)/(?:release-group|release)/([0-9a-f-]{36})").find(value)
                    ?.groupValues?.getOrNull(1)?.let { id ->
                        artworkFromMusicBrainzId(id)?.let { return ResolvedReferenceArtwork("MusicBrainz", it) }
                    }
            }

            // Musicboard et les autres pages publiques : on lit l'image déclarée
            // par la page (cover_large, og:image, twitter:image...).
            artworkFromWebPage(value)?.let {
                val source = if (host.contains("musicboard.app")) "Musicboard" else "Page web"
                return ResolvedReferenceArtwork(source, it)
            }
        }

        // UUID seul : MusicBrainz est le cas le plus fréquent.
        if (Regex("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(value)) {
            artworkFromMusicBrainzId(value)?.let { return ResolvedReferenceArtwork("MusicBrainz", it) }
            artworkFromMusicboardId(value)?.let { return ResolvedReferenceArtwork("Musicboard", it) }
        }

        // ID numérique seul : essaie les catalogues les plus courants.
        if (value.all { it.isDigit() } && value.length >= 4) {
            artworkFromItunesId(value)?.let { return ResolvedReferenceArtwork("Apple/iTunes", it) }
            artworkFromDeezerId(value)?.let { return ResolvedReferenceArtwork("Deezer", it) }
            artworkFromMusicboardId(value)?.let { return ResolvedReferenceArtwork("Musicboard", it) }
        }

        return null
    }

    private fun extractAppleId(url: String): String? {
        val patterns = listOf(
            Regex("(?i)/id(\\d+)(?:[?/#]|$)"),
            Regex("(?i)/album/[^/?#]+/(\\d+)(?:[?/#]|$)"),
            Regex("(?i)[?&]i=(\\d+)")
        )
        return patterns.firstNotNullOfOrNull { it.find(url)?.groupValues?.getOrNull(1) }
    }

    private fun artworkFromItunesId(id: String): ByteArray? {
        val endpoint = "https://itunes.apple.com/lookup?id=${URLEncoder.encode(id, "UTF-8")}&entity=album"
        val body = requestText(endpoint) ?: return null
        val results = runCatching { JSONObject(body).optJSONArray("results") }.getOrNull() ?: return null
        for (i in 0 until results.length()) {
            val item = results.optJSONObject(i) ?: continue
            val base = item.optString("artworkUrl100")
            if (base.isBlank()) continue
            val url = base
                .replace("100x100bb", "1200x1200bb")
                .replace("100x100", "1200x1200")
            downloadValidArtwork(url)?.let { return it }
        }
        return null
    }

    private fun artworkFromDeezerId(id: String): ByteArray? {
        val body = requestText("https://api.deezer.com/album/${URLEncoder.encode(id, "UTF-8")}") ?: return null
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return null
        val url = json.optString("cover_xl")
            .ifBlank { json.optString("cover_big") }
            .ifBlank { json.optString("cover_medium") }
        if (url.isBlank()) return null
        return downloadValidArtwork(url)
    }

    private fun artworkFromMusicBrainzId(id: String): ByteArray? {
        val cleanId = id.trim()
        val urls = listOf(
            "https://coverartarchive.org/release-group/$cleanId/front-1200",
            "https://coverartarchive.org/release-group/$cleanId/front-500",
            "https://coverartarchive.org/release/$cleanId/front-1200",
            "https://coverartarchive.org/release/$cleanId/front-500"
        )
        for (url in urls) {
            downloadValidArtwork(url)?.let { return it }
        }
        return null
    }

    private fun artworkFromMusicboardId(id: String): ByteArray? {
        val cleanId = id.trim()
        if (cleanId.startsWith("http://", true) || cleanId.startsWith("https://", true)) {
            return artworkFromWebPage(cleanId)
        }

        // Musicboard utilise plusieurs types d'identifiants selon l'écran.
        // On essaie les routes publiques connues/usuelles, sans imposer un format.
        val encoded = URLEncoder.encode(cleanId, "UTF-8")
        val endpoints = listOf(
            "https://api.musicboard.app/v2/content/$encoded/",
            "https://api.musicboard.app/v2/contents/$encoded/",
            "https://api.musicboard.app/v2/albums/$encoded/"
        )
        for (endpoint in endpoints) {
            val body = requestText(endpoint) ?: continue
            extractArtworkUrlFromPage(body)?.let { imageUrl ->
                downloadValidArtwork(imageUrl)?.let { return it }
            }
        }
        return null
    }

    private fun artworkFromWebPage(url: String): ByteArray? {
        val body = requestText(url) ?: return null
        val imageUrl = extractArtworkUrlFromPage(body) ?: return null
        return downloadValidArtwork(imageUrl)
    }

    private fun extractArtworkUrlFromPage(body: String): String? {
        val jsonPatterns = listOf(
            Regex("(?i)\\\"cover_large\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
            Regex("(?i)\\\"cover_medium\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
            Regex("(?i)\\\"cover_xl\\\"\\s*:\\s*\\\"([^\\\"]+)\\\""),
            Regex("(?i)\\\"cover\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"")
        )
        jsonPatterns.firstNotNullOfOrNull { pattern ->
            pattern.find(body)?.groupValues?.getOrNull(1)
        }?.let { return cleanWebImageUrl(it) }

        val metaPatterns = listOf(
            Regex("(?is)<meta[^>]+(?:property|name)=[\\\"'](?:og:image|twitter:image)[\\\"'][^>]+content=[\\\"']([^\\\"']+)[\\\"'][^>]*>"),
            Regex("(?is)<meta[^>]+content=[\\\"']([^\\\"']+)[\\\"'][^>]+(?:property|name)=[\\\"'](?:og:image|twitter:image)[\\\"'][^>]*>")
        )
        metaPatterns.firstNotNullOfOrNull { pattern ->
            pattern.find(body)?.groupValues?.getOrNull(1)
        }?.let { return cleanWebImageUrl(it) }

        return null
    }

    private fun cleanWebImageUrl(value: String): String = value
        .replace("\\\\/", "/")
        .replace("&amp;", "&")
        .replace("\\u0026", "&")
        .trim()

    private fun automaticArtworkBytesForSuggestion(album: Album): ByteArray? {
        cachedArtworkBytesInternal(album)?.let { return it }

        for (track in album.tracks) {
            embeddedArtworkInternal(track.uri)?.let { return it }
        }

        val bitmap = runCatching {
            album.tracks.firstNotNullOfOrNull { track ->
                mediaStoreArtworkInternal(track.uri, 900)
            }
        }.getOrNull() ?: return null

        val output = ByteArrayOutputStream()
        return if (bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)) {
            output.toByteArray()
        } else {
            null
        }
    }


    private fun mediaStoreArtworkInternal(uri: Uri, sizePx: Int): Bitmap? {
        return try {
            context.contentResolver.loadThumbnail(uri, Size(sizePx, sizePx), null)
        } catch (_: Exception) {
            null
        }
    }

    private fun legacyAlbumArtworkInternal(albumId: Long, sizePx: Int): Bitmap? {
        val uri = ContentUris.withAppendedId(
            Uri.parse("content://media/external/audio/albumart"),
            albumId
        )
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                decodeBitmap(input.readBytes(), sizePx)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun embeddedArtworkInternal(uri: Uri): ByteArray? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.embeddedPicture
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun loadTrackIndex(): Map<String, CachedIndexedTrack> {
        return runCatching {
            // AtomicFile restaure automatiquement l'ancien index si l'appli a été
            // interrompue pendant une sauvegarde (évite un scan complet au réveil).
            val root = JSONObject(
                AtomicFile(trackIndexFile).openRead().bufferedReader().use { it.readText() }
            )
            if (root.optInt("version", 1) < 2) return@runCatching emptyMap()
            val entries = root.optJSONObject("entries") ?: return@runCatching emptyMap()
            buildMap {
                val keys = entries.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val obj = entries.optJSONObject(key) ?: continue
                    val trackObj = obj.optJSONObject("track") ?: continue
                    val uriString = trackObj.optString("uri", "").trim()
                    if (uriString.isBlank()) continue
                    val track = Track(
                        id = trackObj.optLong("id", -1L),
                        uri = Uri.parse(uriString),
                        title = trackObj.optString("title", ""),
                        artist = trackObj.optString("artist", ""),
                        composer = trackObj.optString("composer", ""),
                        albumTitle = trackObj.optString("albumTitle", ""),
                        albumArtist = trackObj.optString("albumArtist", ""),
                        albumId = trackObj.optLong("albumId", -1L),
                        trackNumber = trackObj.optInt("trackNumber", Int.MAX_VALUE),
                        discNumber = trackObj.optInt("discNumber", 1),
                        durationMs = trackObj.optLong("durationMs", 0L),
                        relativePath = trackObj.optString("relativePath", ""),
                        releaseDate = trackObj.optString("releaseDate", ""),
                        genre = trackObj.optString("genre", "")
                    )
                    if (track.id < 0L) continue
                    put(
                        key,
                        CachedIndexedTrack(
                            dateModified = obj.optLong("dateModified", Long.MIN_VALUE),
                            fileSize = obj.optLong("fileSize", Long.MIN_VALUE),
                            displayName = obj.optString("displayName", ""),
                            track = track,
                            groupAlbumTitle = obj.optString("groupAlbumTitle", ""),
                            groupIdentity = obj.optString("groupIdentity", "")
                        )
                    )
                }
            }
        }.getOrDefault(emptyMap())
    }

    private fun saveTrackIndex() {
        runCatching {
            val entries = JSONObject()
            trackIndex.forEach { (key, entry) ->
                val track = entry.track
                val trackObj = JSONObject().apply {
                    put("id", track.id)
                    put("uri", track.uri.toString())
                    put("title", track.title)
                    put("artist", track.artist)
                    put("composer", track.composer)
                    put("albumTitle", track.albumTitle)
                    put("albumArtist", track.albumArtist)
                    put("albumId", track.albumId)
                    put("trackNumber", track.trackNumber)
                    put("discNumber", track.discNumber)
                    put("durationMs", track.durationMs)
                    put("relativePath", track.relativePath)
                    put("releaseDate", track.releaseDate)
                    put("genre", track.genre)
                }
                entries.put(
                    key,
                    JSONObject().apply {
                        put("dateModified", entry.dateModified)
                        put("fileSize", entry.fileSize)
                        put("displayName", entry.displayName)
                        put("groupAlbumTitle", entry.groupAlbumTitle)
                        put("groupIdentity", entry.groupIdentity)
                        put("track", trackObj)
                    }
                )
            }
            val root = JSONObject().apply {
                put("version", 2)
                put("entries", entries)
            }
            val atomic = AtomicFile(trackIndexFile)
            val stream = atomic.startWrite()
            try {
                stream.write(root.toString().toByteArray(Charsets.UTF_8))
                atomic.finishWrite(stream)
            } catch (error: Throwable) {
                atomic.failWrite(stream)
                throw error
            }
        }
    }

    private fun loadTagCache(): Map<String, CachedTagEntry> {
        if (!tagCacheFile.isFile || tagCacheFile.length() <= 0L) return emptyMap()
        return runCatching {
            val root = JSONObject(tagCacheFile.readText())
            if (root.optInt("version", 1) < 2) return@runCatching emptyMap()
            val entries = root.optJSONObject("entries") ?: return@runCatching emptyMap()
            buildMap {
                val keys = entries.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val obj = entries.optJSONObject(key) ?: continue
                    val tagsObj = obj.optJSONObject("tags") ?: JSONObject()
                    val tags = AudioTags(
                        title = tagsObj.optNullableString("title"),
                        album = tagsObj.optNullableString("album"),
                        artist = tagsObj.optNullableString("artist"),
                        albumArtist = tagsObj.optNullableString("albumArtist"),
                        composer = tagsObj.optNullableString("composer"),
                        releaseDate = tagsObj.optNullableString("releaseDate"),
                        genre = tagsObj.optNullableString("genre"),
                        trackNumber = tagsObj.optNullableInt("trackNumber"),
                        discNumber = tagsObj.optNullableInt("discNumber"),
                        durationMs = tagsObj.optNullableLong("durationMs")
                    )
                    put(
                        key,
                        CachedTagEntry(
                            dateModified = obj.optLong("dateModified", Long.MIN_VALUE),
                            fileSize = obj.optLong("fileSize", Long.MIN_VALUE),
                            tags = tags
                        )
                    )
                }
            }
        }.getOrDefault(emptyMap())
    }

    private fun saveTagCache() {
        runCatching {
            val entries = JSONObject()
            tagCache.forEach { (key, entry) ->
                val tags = JSONObject().apply {
                    entry.tags.title?.let { put("title", it) }
                    entry.tags.album?.let { put("album", it) }
                    entry.tags.artist?.let { put("artist", it) }
                    entry.tags.albumArtist?.let { put("albumArtist", it) }
                    entry.tags.composer?.let { put("composer", it) }
                    entry.tags.releaseDate?.let { put("releaseDate", it) }
                    entry.tags.genre?.let { put("genre", it) }
                    entry.tags.trackNumber?.let { put("trackNumber", it) }
                    entry.tags.discNumber?.let { put("discNumber", it) }
                    entry.tags.durationMs?.let { put("durationMs", it) }
                }
                entries.put(
                    key,
                    JSONObject().apply {
                        put("dateModified", entry.dateModified)
                        put("fileSize", entry.fileSize)
                        put("tags", tags)
                    }
                )
            }
            val root = JSONObject().apply {
                put("version", 2)
                put("entries", entries)
            }
            val tmp = File(tagCacheFile.parentFile, tagCacheFile.name + ".tmp")
            tmp.writeText(root.toString())
            if (tagCacheFile.exists()) tagCacheFile.delete()
            if (!tmp.renameTo(tagCacheFile)) {
                tagCacheFile.writeText(root.toString())
                tmp.delete()
            }
        }
    }

    private fun JSONObject.optNullableString(name: String): String? =
        optString(name, "").trim().takeIf { it.isNotEmpty() }

    private fun JSONObject.optNullableInt(name: String): Int? =
        if (has(name) && !isNull(name)) optInt(name) else null

    private fun JSONObject.optNullableLong(name: String): Long? =
        if (has(name) && !isNull(name)) optLong(name) else null

    private fun readTags(uri: Uri): AudioTags {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            AudioTags(
                title = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)),
                album = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)),
                artist = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)),
                albumArtist = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)),
                composer = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_COMPOSER)),
                releaseDate = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)),
                genre = cleanTag(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE)),
                trackNumber = parseTagNumber(
                    retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)
                ),
                discNumber = parseTagNumber(
                    retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)
                ),
                durationMs = retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
            )
        } catch (_: Exception) {
            AudioTags()
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun customArtworkInternal(album: Album, sizePx: Int): Bitmap? {
        val bytes = customArtworkBytesInternal(album) ?: return null
        return decodeBitmap(bytes, sizePx)
    }

    private fun customArtworkBytesInternal(album: Album): ByteArray? {
        val file = customCoverFile(album)
        if (!file.isFile || file.length() <= 0L) return null
        return runCatching { file.readBytes() }.getOrNull()
    }

    private fun cachedArtworkInternal(album: Album, sizePx: Int): Bitmap? {
        val bytes = cachedArtworkBytesInternal(album) ?: return null
        return decodeBitmap(bytes, sizePx)
    }

    private fun cachedArtworkBytesInternal(album: Album): ByteArray? {
        val file = coverCacheFile(album)
        if (!file.isFile || file.length() <= 0L) return null
        return runCatching { file.readBytes() }.getOrNull()
    }

    private fun saveArtworkCache(album: Album, bytes: ByteArray) {
        if (bytes.isEmpty()) return
        writeArtworkFile(coverCacheFile(album), bytes)
    }

    private fun writeArtworkFile(target: File, bytes: ByteArray): Boolean {
        return runCatching {
            target.parentFile?.mkdirs()
            val temp = File(target.parentFile, "${target.name}.tmp")
            temp.writeBytes(bytes)
            if (!temp.renameTo(target)) {
                target.writeBytes(bytes)
                temp.delete()
            }
            target.isFile && target.length() > 0L
        }.getOrDefault(false)
    }

    private fun coverCacheFile(album: Album): File =
        File(coverDirectory, "${albumHash(album)}.cover")

    private fun customCoverFile(album: Album): File =
        File(customCoverDirectory, "${albumHash(album)}.cover")

    private fun albumHash(album: Album): String = sha256(album.key.toByteArray(Charsets.UTF_8))

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    private data class SuggestionCandidate(
        val url: String,
        val source: String,
        val albumTitle: String,
        val artist: String,
        val score: Int
    )

    private fun collectItunesSuggestionCandidates(album: Album): List<SuggestionCandidate> {
        val resultsOut = mutableListOf<SuggestionCandidate>()
        val queries = artworkSearchTexts(album).take(3)
        val countries = listOf("FR", "US", "GB", "DE")
        for (queryText in queries) {
            for (country in countries) {
                val query = URLEncoder.encode(queryText, "UTF-8")
                val endpoint = "https://itunes.apple.com/search?term=$query&media=music&entity=album&limit=20&country=$country"
                val body = requestText(endpoint) ?: continue
                val results = runCatching { JSONObject(body).optJSONArray("results") }.getOrNull() ?: continue
                for (i in 0 until results.length()) {
                    val item = results.optJSONObject(i) ?: continue
                    val resultAlbum = item.optString("collectionName")
                    val resultArtist = item.optString("artistName")
                    val baseUrl = item.optString("artworkUrl100")
                    if (baseUrl.isBlank()) continue
                    val score = artworkMatchScore(album, resultAlbum, resultArtist)
                    if (score < 10) continue
                    val url = baseUrl
                        .replace("100x100bb", "600x600bb")
                        .replace("100x100", "600x600")
                    resultsOut += SuggestionCandidate(url, "Apple", resultAlbum, resultArtist, score)
                }
            }
        }
        return resultsOut
    }

    private fun collectDeezerSuggestionCandidates(album: Album): List<SuggestionCandidate> {
        val resultsOut = mutableListOf<SuggestionCandidate>()
        val terms = deezerSearchTerms(album)

        for (term in terms) {
            val query = URLEncoder.encode(term, "UTF-8")
            val endpoint = "https://api.deezer.com/search/album?q=$query&limit=25"
            val body = requestText(endpoint) ?: continue
            val results = runCatching { JSONObject(body).optJSONArray("data") }.getOrNull() ?: continue
            for (i in 0 until results.length()) {
                val item = results.optJSONObject(i) ?: continue
                val resultAlbum = item.optString("title")
                val resultArtist = item.optJSONObject("artist")?.optString("name").orEmpty()
                val url = item.optString("cover_xl").ifBlank { item.optString("cover_big") }
                if (url.isBlank()) continue
                val score = artworkMatchScore(album, resultAlbum, resultArtist)
                if (score < 10) continue
                resultsOut += SuggestionCandidate(url, "Deezer", resultAlbum, resultArtist, score)
            }
        }
        return resultsOut
    }

    private fun collectMusicBrainzSuggestionCandidates(album: Album): List<SuggestionCandidate> {
        val resultsOut = mutableListOf<SuggestionCandidate>()
        val folder = folderHints(album)
        val titleVariants = listOf(album.title, simplifiedAlbumTitle(album.title), folder.album, folder.leafFolder)
            .mapNotNull { it?.trim() }
            .filter { it.isNotBlank() }
            .distinctBy { normalizeKey(it) }
        val artistVariants = linkedSetOf<String>()
        album.artist.takeUnless { isGenericAlbumArtist(it) }?.let { artistVariants.add(it) }
        folder.artist?.let { artistVariants.add(it) }
        folder.parentFolder?.let { artistVariants.add(it) }
        album.tracks.firstOrNull()?.artist?.takeUnless { isUnknownTag(it) }?.let { artistVariants.add(it) }

        for (title in titleVariants) {
            val queryTexts = buildList {
                for (artist in artistVariants) {
                    add("releasegroup:\"$title\" AND artist:\"$artist\"")
                }
                add("releasegroup:\"$title\"")
            }.distinct()

            for (queryText in queryTexts) {
                val query = URLEncoder.encode(queryText, "UTF-8")
                val endpoint = "https://musicbrainz.org/ws/2/release-group/?query=$query&fmt=json&limit=12"
                val body = requestMusicBrainzText(endpoint) ?: continue
                val groups = runCatching { JSONObject(body).optJSONArray("release-groups") }.getOrNull() ?: continue

                for (i in 0 until groups.length()) {
                    val item = groups.optJSONObject(i) ?: continue
                    val id = item.optString("id")
                    if (id.isBlank()) continue
                    val resultAlbum = item.optString("title")
                    val credits = item.optJSONArray("artist-credit")
                    val resultArtist = credits?.optJSONObject(0)?.optString("name").orEmpty()
                    val score = artworkMatchScore(album, resultAlbum, resultArtist)
                    if (score < 10) continue

                    resultsOut += SuggestionCandidate(
                        url = "https://coverartarchive.org/release-group/$id/front-500",
                        source = "MusicBrainz",
                        albumTitle = resultAlbum,
                        artist = resultArtist,
                        score = score
                    )
                }
            }
        }
        return resultsOut
    }


    private fun findOnlineArtworkBytes(album: Album): ByteArray? {
        // 1) Apple Music / iTunes : plusieurs pays + requêtes plus tolérantes.
        findItunesArtworkUrl(album)?.let { url ->
            downloadValidArtwork(url)?.let { return it }
        }

        // 2) Deezer : requête stricte puis recherche élargie sur le titre d'album.
        findDeezerArtworkUrl(album)?.let { url ->
            downloadValidArtwork(url)?.let { return it }
        }

        // 3) MusicBrainz + Cover Art Archive : très utile pour les albums moins courants,
        // éditions étrangères, remasters et anciennes compilations.
        findMusicBrainzArtworkBytes(album)?.let { return it }

        return null
    }

    private fun downloadValidArtwork(url: String): ByteArray? {
        val bytes = downloadBytes(url) ?: return null
        if (bytes.isEmpty()) return null
        return bytes.takeIf { decodeBitmap(it, 64) != null }
    }

    private fun findItunesArtworkUrl(album: Album): String? {
        var bestScore = Int.MIN_VALUE
        var bestUrl: String? = null

        val queries = artworkSearchTexts(album)
        val countries = listOf("FR", "US", "GB")

        for (queryText in queries) {
            for (country in countries) {
                val query = URLEncoder.encode(queryText, "UTF-8")
                val endpoint = "https://itunes.apple.com/search?term=$query&media=music&entity=album&limit=25&country=$country"
                val body = requestText(endpoint) ?: continue
                val results = runCatching { JSONObject(body).optJSONArray("results") }.getOrNull() ?: continue

                for (i in 0 until results.length()) {
                    val item = results.optJSONObject(i) ?: continue
                    val resultAlbum = item.optString("collectionName")
                    val resultArtist = item.optString("artistName")
                    val url = item.optString("artworkUrl100")
                    if (url.isBlank()) continue

                    val score = artworkMatchScore(album, resultAlbum, resultArtist)
                    if (score > bestScore) {
                        bestScore = score
                        bestUrl = url
                            .replace("100x100bb", "600x600bb")
                            .replace("100x100", "600x600")
                    }
                }

                // Un excellent résultat ne justifie pas d'interroger d'autres pays.
                if (bestScore >= 105) return bestUrl
            }
        }
        return bestUrl?.takeIf { bestScore >= 62 }
    }

    private fun findDeezerArtworkUrl(album: Album): String? {
        var bestScore = Int.MIN_VALUE
        var bestUrl: String? = null

        val terms = deezerSearchTerms(album)

        for (term in terms) {
            val query = URLEncoder.encode(term, "UTF-8")
            val endpoint = "https://api.deezer.com/search/album?q=$query&limit=25"
            val body = requestText(endpoint) ?: continue
            val results = runCatching { JSONObject(body).optJSONArray("data") }.getOrNull() ?: continue

            for (i in 0 until results.length()) {
                val item = results.optJSONObject(i) ?: continue
                val resultAlbum = item.optString("title")
                val resultArtist = item.optJSONObject("artist")?.optString("name").orEmpty()
                val url = item.optString("cover_xl").ifBlank { item.optString("cover_big") }
                if (url.isBlank()) continue

                val score = artworkMatchScore(album, resultAlbum, resultArtist)
                if (score > bestScore) {
                    bestScore = score
                    bestUrl = url
                }
            }

            if (bestScore >= 105) return bestUrl
        }
        return bestUrl?.takeIf { bestScore >= 56 }
    }

    private fun findMusicBrainzArtworkBytes(album: Album): ByteArray? {
        val folder = folderHints(album)
        val titleVariants = listOf(album.title, simplifiedAlbumTitle(album.title), folder.album, folder.leafFolder)
            .mapNotNull { it?.trim() }
            .filter { it.isNotBlank() }
            .distinctBy { normalizeKey(it) }

        val artistVariants = linkedSetOf<String>()
        album.artist.takeUnless { isGenericAlbumArtist(it) }?.let { artistVariants.add(it) }
        folder.artist?.let { artistVariants.add(it) }
        folder.parentFolder?.let { artistVariants.add(it) }
        album.tracks.firstOrNull()?.artist?.takeUnless { isUnknownTag(it) }?.let { artistVariants.add(it) }

        var bestId: String? = null
        var bestScore = Int.MIN_VALUE

        for (title in titleVariants) {
            val queryTexts = buildList {
                for (artist in artistVariants) {
                    add("releasegroup:\"$title\" AND artist:\"$artist\"")
                }
                add("releasegroup:\"$title\"")
            }.distinct()

            for (queryText in queryTexts) {
                val query = URLEncoder.encode(queryText, "UTF-8")
                val endpoint = "https://musicbrainz.org/ws/2/release-group/?query=$query&fmt=json&limit=12"
                val body = requestMusicBrainzText(endpoint) ?: continue
                val groups = runCatching { JSONObject(body).optJSONArray("release-groups") }.getOrNull() ?: continue

                for (i in 0 until groups.length()) {
                    val item = groups.optJSONObject(i) ?: continue
                    val id = item.optString("id")
                    if (id.isBlank()) continue
                    val resultAlbum = item.optString("title")
                    val credits = item.optJSONArray("artist-credit")
                    val resultArtist = credits?.optJSONObject(0)?.optString("name").orEmpty()
                    val score = artworkMatchScore(album, resultAlbum, resultArtist)
                    if (score > bestScore) {
                        bestScore = score
                        bestId = id
                    }
                }

                if (bestScore >= 105) break
            }
            if (bestScore >= 105) break
        }

        val id = bestId?.takeIf { bestScore >= 54 } ?: return null
        val urls = listOf(
            "https://coverartarchive.org/release-group/$id/front-500",
            "https://coverartarchive.org/release-group/$id/front"
        )
        for (url in urls) {
            downloadValidArtwork(url)?.let { return it }
        }
        return null
    }

    private fun artworkSearchTexts(album: Album): List<String> {
        val cleanTitle = simplifiedAlbumTitle(album.title)
        val folder = folderHints(album)
        val artistCandidates = linkedSetOf<String>()
        val albumCandidates = linkedSetOf<String>()

        fun addArtist(value: String?) {
            val candidate = value?.trim().orEmpty()
            if (candidate.isNotBlank() && !isUnknownTag(candidate)) artistCandidates.add(candidate)
        }
        fun addAlbum(value: String?) {
            val candidate = value?.trim().orEmpty()
            if (candidate.isNotBlank()) albumCandidates.add(candidate)
        }

        addArtist(album.artist.takeUnless { isGenericAlbumArtist(it) })
        addArtist(folder.artist)
        addArtist(folder.parentFolder)
        val mostUsefulTrackArtist = album.tracks
            .map { it.albumArtist.ifBlank { it.artist } }
            .filter { it.isNotBlank() && !isUnknownTag(it) }
            .groupingBy { it }
            .eachCount()
            .maxByOrNull { it.value }
            ?.key
        addArtist(mostUsefulTrackArtist)

        addAlbum(album.title)
        addAlbum(cleanTitle)
        addAlbum(folder.album)
        addAlbum(folder.leafFolder)
        addAlbum(folder.combinedFolder)
        album.tracks.firstOrNull()?.albumTitle?.let(::addAlbum)

        val results = linkedSetOf<String>()
        for (artist in artistCandidates) {
            for (albumTitle in albumCandidates) {
                results.add("$artist $albumTitle")
            }
        }
        results.addAll(albumCandidates)
        return results.map { it.trim() }
            .filter { it.isNotBlank() }
            .distinctBy { normalizeKey(it) }
    }

    private fun deezerSearchTerms(album: Album): List<String> {
        val folder = folderHints(album)
        val cleanTitle = simplifiedAlbumTitle(album.title)
        val artistCandidates = linkedSetOf<String>()
        val albumCandidates = linkedSetOf<String>()

        fun addArtist(value: String?) {
            val candidate = value?.trim().orEmpty()
            if (candidate.isNotBlank() && !isUnknownTag(candidate)) artistCandidates.add(candidate)
        }
        fun addAlbum(value: String?) {
            val candidate = value?.trim().orEmpty()
            if (candidate.isNotBlank()) albumCandidates.add(candidate)
        }

        addArtist(album.artist.takeUnless { isGenericAlbumArtist(it) })
        addArtist(folder.artist)
        addArtist(folder.parentFolder)
        addArtist(album.tracks.firstOrNull()?.artist)

        addAlbum(album.title)
        addAlbum(cleanTitle)
        addAlbum(folder.album)
        addAlbum(folder.leafFolder)
        addAlbum(folder.combinedFolder)

        val terms = linkedSetOf<String>()
        for (artist in artistCandidates) {
            for (albumTitle in albumCandidates) {
                terms.add("$artist $albumTitle")
            }
        }
        terms.addAll(albumCandidates)
        return terms.map { it.trim() }
            .filter { it.isNotBlank() }
            .distinctBy { normalizeKey(it) }
            .take(8)
    }

    private data class FolderHints(
        val artist: String? = null,
        val album: String? = null,
        val parentFolder: String? = null,
        val leafFolder: String? = null,
        val combinedFolder: String? = null
    )

    private fun folderHints(album: Album): FolderHints {
        val path = album.tracks.firstOrNull()?.relativePath.orEmpty()
        if (path.isBlank()) return FolderHints()
        val parts = path.trim('/').split('/').filter { it.isNotBlank() }.toMutableList()
        if (parts.firstOrNull()?.equals("Music", ignoreCase = true) == true) parts.removeAt(0)
        if (parts.isNotEmpty() && isDiscFolder(parts.last())) parts.removeAt(parts.lastIndex)
        if (parts.isEmpty()) return FolderHints()

        val leaf = parts.last().trim().takeIf { it.isNotBlank() }
        val parent = parts.dropLast(1).lastOrNull()?.trim()?.takeIf { it.isNotBlank() }
        val combined = parts.joinToString(" - ").trim().takeIf { it.isNotBlank() }

        var guessedArtist: String? = null
        var guessedAlbum: String? = leaf

        leaf?.let { folderName ->
            parseArtistAlbumFromFolder(folderName)?.let { (artist, albumName) ->
                guessedArtist = artist
                guessedAlbum = albumName
            }
        }

        if (guessedArtist.isNullOrBlank()) {
            guessedArtist = parent
        }

        return FolderHints(
            artist = guessedArtist,
            album = guessedAlbum,
            parentFolder = parent,
            leafFolder = leaf,
            combinedFolder = combined
        )
    }

    private fun parseArtistAlbumFromFolder(value: String): Pair<String, String>? {
        val separators = listOf(" - ", " – ", " — ", "_-")
        for (separator in separators) {
            val index = value.indexOf(separator)
            if (index > 0 && index < value.length - separator.length) {
                val left = value.substring(0, index).trim()
                val right = value.substring(index + separator.length).trim()
                if (left.isNotBlank() && right.isNotBlank()) {
                    return left to right
                }
            }
        }
        return null
    }

    private fun simplifiedAlbumTitle(value: String): String {
        return value
            .replace(
                Regex("""(?i)\s*[\[(].*?(?:remaster(?:ed)?|deluxe|expanded|anniversary|edition|bonus|version|disc|cd).*?[\])]\s*"""),
                " "
            )
            .replace(
                Regex("""(?i)\s*[-–—:]\s*(?:remaster(?:ed)?|deluxe|expanded|anniversary|edition|bonus|version).*$"""),
                ""
            )
            .replace(Regex("""(?i)\b(?:remaster(?:ed)?|deluxe|expanded)\s+(?:edition|version)\b"""), " ")
            .replace(Regex("""\s+"""), " ")
            .trim()
            .ifBlank { value.trim() }
    }

    private fun isGenericAlbumArtist(value: String): Boolean {
        val normalized = normalizeKey(value)
        return normalized == normalizeKey("Artistes divers") ||
            normalized == normalizeKey("Artiste inconnu") ||
            normalized == normalizeKey("Various Artists") ||
            normalized == normalizeKey("Unknown Artist")
    }

    private fun artworkMatchScore(album: Album, candidateAlbum: String, candidateArtist: String): Int {
        val wantedAlbum = normalizeKey(album.title)
        val wantedAlbumSimple = normalizeKey(simplifiedAlbumTitle(album.title))
        val foundAlbum = normalizeKey(candidateAlbum)
        val foundAlbumSimple = normalizeKey(simplifiedAlbumTitle(candidateAlbum))
        val wantedArtist = normalizeKey(album.artist)
        val foundArtist = normalizeKey(candidateArtist)

        var score = 0
        score += when {
            wantedAlbum == foundAlbum -> 82
            wantedAlbumSimple.isNotBlank() && wantedAlbumSimple == foundAlbumSimple -> 74
            wantedAlbum.isNotBlank() && (foundAlbum.contains(wantedAlbum) || wantedAlbum.contains(foundAlbum)) -> 58
            wantedAlbumSimple.isNotBlank() &&
                (foundAlbumSimple.contains(wantedAlbumSimple) || wantedAlbumSimple.contains(foundAlbumSimple)) -> 54
            tokenOverlap(wantedAlbumSimple, foundAlbumSimple) >= 0.75 -> 46
            tokenOverlap(wantedAlbumSimple, foundAlbumSimple) >= 0.5 -> 28
            else -> 0
        }

        if (isGenericAlbumArtist(album.artist)) {
            score += 10
        } else {
            score += when {
                wantedArtist == foundArtist -> 35
                wantedArtist.isNotBlank() && (foundArtist.contains(wantedArtist) || wantedArtist.contains(foundArtist)) -> 23
                tokenOverlap(wantedArtist, foundArtist) >= 0.65 -> 16
                tokenOverlap(wantedArtist, foundArtist) >= 0.4 -> 9
                else -> 0
            }
        }
        return score
    }

    private fun tokenOverlap(a: String, b: String): Double {
        val left = a.split(' ').filter { it.isNotBlank() }.toSet()
        val right = b.split(' ').filter { it.isNotBlank() }.toSet()
        if (left.isEmpty() || right.isEmpty()) return 0.0
        return left.intersect(right).size.toDouble() / left.union(right).size.toDouble()
    }


    private fun requestMusicBrainzText(url: String): String? {
        synchronized(musicBrainzLock) {
            val now = System.currentTimeMillis()
            val waitMs = (1050L - (now - lastMusicBrainzRequestAt)).coerceAtLeast(0L)
            if (waitMs > 0L) {
                runCatching { Thread.sleep(waitMs) }
            }
            lastMusicBrainzRequestAt = System.currentTimeMillis()
            return requestText(url)
        }
    }

    private fun requestText(url: String): String? {
        val connection = openConnection(url) ?: return null
        return try {
            if (connection.responseCode !in 200..299) return null
            connection.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadBytes(url: String): ByteArray? {
        val connection = openConnection(url) ?: return null
        return try {
            if (connection.responseCode !in 200..299) return null
            val length = connection.contentLengthLong
            if (length > 8L * 1024L * 1024L) return null
            connection.inputStream.use { it.readBytes() }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(url: String): HttpURLConnection? {
        return try {
            (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 8000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/151 Mobile Safari/537.36 RoadPlayer/0.21")
                setRequestProperty("Accept", "application/json,image/*,*/*")
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun decodeBitmap(bytes: ByteArray, sizePx: Int): Bitmap? {
        if (bytes.isEmpty()) return null
        return runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            var sample = 1
            while (bounds.outWidth / sample > sizePx * 2 || bounds.outHeight / sample > sizePx * 2) {
                sample *= 2
            }
            val options = BitmapFactory.Options().apply { inSampleSize = sample.coerceAtLeast(1) }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        }.getOrNull()
    }

    private fun isSupported(displayName: String): Boolean =
        displayName.endsWith(".mp3", ignoreCase = true) ||
            displayName.endsWith(".flac", ignoreCase = true)

    private fun cleanTag(value: String?): String? {
        val cleaned = value?.trim()?.replace(Regex("\\s+"), " ").orEmpty()
        if (cleaned.isBlank() || isUnknownTag(cleaned)) return null
        return cleaned
    }

    private fun isUnknownTag(value: String): Boolean {
        val normalized = value.trim().lowercase(Locale.ROOT)
        return normalized in setOf(
            "<unknown>",
            "unknown",
            "null",
            "artiste inconnu",
            "unknown artist",
            "album inconnu",
            "unknown album"
        )
    }

    private fun albumFromPath(relativePath: String): String? {
        val parts = relativePath.trim('/').split('/').filter { it.isNotBlank() }
        if (parts.isEmpty()) return null
        val withoutMusic = if (parts.first().equals("Music", ignoreCase = true)) parts.drop(1) else parts
        if (withoutMusic.isEmpty()) return null

        val last = withoutMusic.last()
        return if (isDiscFolder(last) && withoutMusic.size >= 2) withoutMusic[withoutMusic.lastIndex - 1] else last
    }

    private fun albumFolderIdentity(relativePath: String): String {
        val parts = relativePath.trim('/').split('/').filter { it.isNotBlank() }.toMutableList()
        if (parts.firstOrNull()?.equals("Music", ignoreCase = true) == true) parts.removeAt(0)
        if (parts.isNotEmpty() && isDiscFolder(parts.last())) parts.removeAt(parts.lastIndex)
        return normalizeKey(parts.joinToString("/"))
    }

    private fun discFromPath(relativePath: String): Int? {
        val parts = relativePath.trim('/').split('/').filter { it.isNotBlank() }
        for (part in parts.asReversed()) {
            val match = Regex("(?i)^(?:cd|disc|disk|disque)\\s*[-_ ]?(\\d{1,2})$").find(part.trim())
            if (match != null) return match.groupValues[1].toIntOrNull()
        }
        return null
    }

    private fun isDiscFolder(value: String): Boolean =
        Regex("(?i)^(?:cd|disc|disk|disque)\\s*[-_ ]?\\d{1,2}$").matches(value.trim())

    private fun stripDiscSuffix(value: String): String {
        return value
            .replace(
                Regex("(?i)\\s*[\\[(]?(?:cd|disc|disk|disque)\\s*[-_ ]?\\d{1,2}[\\])]?$"),
                ""
            )
            .trim()
    }

    private fun parseTagNumber(value: String?): Int? {
        val firstNumber = Regex("\\d+").find(value.orEmpty())?.value?.toIntOrNull()
        return firstNumber?.takeIf { it > 0 }
    }

    private fun mediaStoreTrackNumber(raw: Int): Int? {
        if (raw <= 0) return null
        val value = raw % 1000
        return value.takeIf { it > 0 }
    }

    private fun mediaStoreDiscNumber(raw: Int): Int? {
        if (raw < 1000) return null
        return (raw / 1000).takeIf { it > 0 }
    }

    private fun leadingNumber(fileName: String): Int? {
        return Regex("^\\s*(\\d{1,3})(?:\\D|$)")
            .find(fileName)
            ?.groupValues
            ?.getOrNull(1)
            ?.toIntOrNull()
            ?.takeIf { it > 0 }
    }

    private fun normalizeKey(value: String): String {
        val decomposed = Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
        return decomposed
            .replace(Regex("\\p{M}+"), "")
            .lowercase(Locale.ROOT)
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
            .trim()
            .replace(Regex("\\s+"), " ")
    }

    private fun mostCommon(values: List<String>): String? {
        if (values.isEmpty()) return null
        return values
            .groupingBy { it }
            .eachCount()
            .maxByOrNull { it.value }
            ?.key
    }

    private data class TaggedTrack(
        val track: Track,
        val groupAlbumTitle: String,
        val groupIdentity: String
    )

    private data class FileFingerprint(
        val displayName: String,
        val relativePath: String,
        val dateModified: Long,
        val fileSize: Long
    )

    private data class CachedIndexedTrack(
        val dateModified: Long,
        val fileSize: Long,
        val displayName: String,
        val track: Track,
        val groupAlbumTitle: String,
        val groupIdentity: String
    )

    private data class CachedTagEntry(
        val dateModified: Long,
        val fileSize: Long,
        val tags: AudioTags
    )

    private data class AudioTags(
        val title: String? = null,
        val album: String? = null,
        val artist: String? = null,
        val albumArtist: String? = null,
        val composer: String? = null,
        val releaseDate: String? = null,
        val genre: String? = null,
        val trackNumber: Int? = null,
        val discNumber: Int? = null,
        val durationMs: Long? = null
    )
}
