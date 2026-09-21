package com.nik.roadplayer

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.LruCache
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext


private data class UiColorProfile(
    val name: String,
    val primary: Color,
    val secondary: Color,
    val accent: Color,
    val detail: Color,
    val onPrimary: Color
)

private val UiColorProfiles = listOf(
    UiColorProfile(
        name = "ROUGE",
        primary = Color(0xFFFF3131),
        secondary = Color(0xFFFFDE59),
        accent = Color(0xFF1800AD),
        detail = Color(0xFFFFFFFF),
        onPrimary = Color.White
    ),
    UiColorProfile(
        name = "JAUNE",
        primary = Color(0xFFFFDE59),
        secondary = Color(0xFF1800AD),
        accent = Color(0xFFFFFFFF),
        detail = Color(0xFFFF3131),
        onPrimary = Color(0xFF202830)
    ),
    UiColorProfile(
        name = "BLEU",
        primary = Color(0xFF1800AD),
        secondary = Color(0xFFFFFFFF),
        accent = Color(0xFFFF3131),
        detail = Color(0xFFFFDE59),
        onPrimary = Color.White
    ),
    UiColorProfile(
        name = "BLANC",
        primary = Color(0xFFFFFFFF),
        secondary = Color(0xFFFF3131),
        accent = Color(0xFFFFDE59),
        detail = Color(0xFF1800AD),
        onPrimary = Color(0xFF1800AD)
    )
)

private val LocalUiColorProfile = staticCompositionLocalOf { UiColorProfiles.first() }

class MainActivity : ComponentActivity() {
    private val diagnosticFile by lazy {
        java.io.File(filesDir, "merylcarplayer_test_crash.txt")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Conserver le vrai motif du crash pour pouvoir le lire sans PC au prochain lancement.
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                diagnosticFile.writeText(throwable.stackTraceToString())
            }
            previousHandler?.uncaughtException(thread, throwable)
        }
        super.onCreate(savedInstanceState)

        if (diagnosticFile.exists()) {
            showCrashDiagnostic(diagnosticFile.readText())
            return
        }
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFF202830)) {
                    MerylCarPlayerApp()
                }
            }
        }
    }

    private fun showCrashDiagnostic(report: String) {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            setBackgroundColor(android.graphics.Color.rgb(32, 40, 48))
        }
        val heading = android.widget.TextView(this).apply {
            text = "MerylCarPlayer TEST V0.70 — Diagnostic du plantage"
            textSize = 20f
            setTextColor(android.graphics.Color.WHITE)
        }
        layout.addView(heading)
        val details = android.widget.TextView(this).apply {
            text = report
            textSize = 13f
            setTextColor(android.graphics.Color.WHITE)
            setTextIsSelectable(true)
        }
        val scroll = android.widget.ScrollView(this).apply {
            addView(details)
        }
        layout.addView(
            scroll,
            android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
            )
        )
        layout.addView(android.widget.Button(this).apply {
            text = "Copier le diagnostic"
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Erreur MerylCarPlayer TEST", report))
                Toast.makeText(this@MainActivity, "Diagnostic copié", Toast.LENGTH_SHORT).show()
            }
        })
        layout.addView(android.widget.Button(this).apply {
            text = "Réessayer d'ouvrir"
            setOnClickListener {
                diagnosticFile.delete()
                recreate()
            }
        })
        setContentView(layout)
    }
}

@Composable
private fun MerylCarPlayerApp() {
    val context = LocalContext.current
    // Construire l'index et les caches volumineux hors du thread graphique.
    // Afficher le chargement immédiatement, même avant l'ouverture de la bibliothèque.
    var repository by remember { mutableStateOf<MusicRepository?>(null) }
    LaunchedEffect(context.applicationContext) {
        repository = withContext(Dispatchers.IO) {
            MusicRepository(context.applicationContext)
        }
    }
    val readyRepository = repository
    if (readyRepository == null) {
        CompositionLocalProvider(LocalUiColorProfile provides UiColorProfiles[1]) {
            Column(
                modifier = Modifier.fillMaxSize().background(Color(0xFF202830))
            ) {
                PlayerHeader(version = "V0.70")
                StartupLoadingBar(progress = null)
            }
        }
        return
    }
    MerylCarPlayerContent(repository = readyRepository)
}

@Composable
private fun MerylCarPlayerContent(repository: MusicRepository) {
    val context = LocalContext.current
    // V0.48 : le profil JAUNE est maintenant le profil unique et fixe.
    val colorProfile = UiColorProfiles[1]

    val coroutineScope = rememberCoroutineScope()

    var albums by remember { mutableStateOf<List<Album>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var scanProgress by remember { mutableStateOf<Float?>(null) }
    var searching by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var searchDialogOpen by remember { mutableStateOf(false) }
    var gridColumns by rememberSaveable { mutableStateOf(3) }
    var librarySortMode by rememberSaveable { mutableStateOf("artist") }
    var genreCategory by rememberSaveable { mutableStateOf("albums") }
    var genreMenuOpen by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableStateOf(0) } // 0 = Albums, 1 = Envoi
    var sendPickerOpen by remember { mutableStateOf(false) }
    var sendAlbums by remember { mutableStateOf<List<Album>>(emptyList()) }
    var permissionGranted by remember { mutableStateOf(hasAudioPermission(context)) }
    var selectedAlbum by remember { mutableStateOf<Album?>(null) }
    var coverActionAlbum by remember { mutableStateOf<Album?>(null) }
    var suggestionAlbum by remember { mutableStateOf<Album?>(null) }
    var imagePickerAlbum by remember { mutableStateOf<Album?>(null) }
    var coverRevision by remember { mutableStateOf(0) }
    val libraryGridState = rememberLazyGridState()
    var referenceAlbum by remember { mutableStateOf<Album?>(null) }
    var referenceInitialText by remember { mutableStateOf("") }
    var metadataEditAlbum by remember { mutableStateOf<Album?>(null) }
    var playlistTargetAlbum by remember { mutableStateOf<Album?>(null) }
    var hideConfirmAlbum by remember { mutableStateOf<Album?>(null) }
    var deleteConfirmAlbum by remember { mutableStateOf<Album?>(null) }
    var deletePendingAlbum by remember { mutableStateOf<Album?>(null) }
    var mergeTargetAlbum by remember { mutableStateOf<Album?>(null) }
    var playlists by remember { mutableStateOf<List<PlaylistSummary>>(emptyList()) }

    val controllerFuture = remember {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        MediaController.Builder(context, token).buildAsync()
    }

    val controller by produceState<MediaController?>(initialValue = null, controllerFuture) {
        controllerFuture.addListener(
            { value = runCatching { controllerFuture.get() }.getOrNull() },
            ContextCompat.getMainExecutor(context)
        )
    }

    DisposableEffect(Unit) {
        onDispose { MediaController.releaseFuture(controllerFuture) }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        permissionGranted = granted
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    val albumFolderPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            coroutineScope.launch {
                refreshing = true
                try {
                    val beforeKeys = albums.mapTo(mutableSetOf()) { it.key }
                    val scannedTracks = repository.scanSelectedAlbumFolder(uri)
                    if (scannedTracks < 0) {
                        Toast.makeText(
                            context,
                            "Choisis un dossier d’album dans Music sur la carte SD",
                            Toast.LENGTH_LONG
                        ).show()
                        return@launch
                    }
                    if (scannedTracks == 0) {
                        Toast.makeText(
                            context,
                            "Aucun MP3/FLAC trouvé dans ce dossier",
                            Toast.LENGTH_SHORT
                        ).show()
                        return@launch
                    }

                    delay(120L)
                    val refreshed = repository.quickRefreshAlbumsFromSdMusic()
                    val newCount = refreshed.count { it.key !in beforeKeys }
                    albums = refreshed
                    playlists = repository.listPlaylists()
                    Toast.makeText(
                        context,
                        when {
                            newCount > 1 -> "$newCount albums ajoutés"
                            newCount == 1 -> "Album ajouté"
                            else -> "Album rescanné"
                        },
                        Toast.LENGTH_SHORT
                    ).show()
                } finally {
                    refreshing = false
                }
            }
        }
    }

    val imagePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        val album = imagePickerAlbum
        imagePickerAlbum = null
        if (uri != null && album != null) {
            coroutineScope.launch {
                if (repository.saveCustomArtwork(album, uri)) {
                    coverCache.remove(album.key)
                    coverRevision += 1
                }
            }
        }
    }

    val deleteAlbumLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        val album = deletePendingAlbum
        deletePendingAlbum = null
        if (result.resultCode == Activity.RESULT_OK && album != null) {
            coroutineScope.launch {
                refreshing = true
                try {
                    // La suppression est déjà confirmée par Android : retire les titres du
                    // cache immédiatement, puis fais seulement le contrôle incrémental.
                    repository.forgetAlbumFromLocalIndex(album)
                    delay(80L)
                    albums = repository.quickRefreshAlbumsFromSdMusic()
                    playlists = repository.listPlaylists()
                    if (selectedAlbum?.key == album.key) {
                        controller?.stop()
                        controller?.clearMediaItems()
                        selectedAlbum = null
                    }
                    coverCache.remove(album.key)
                    coverRevision += 1
                    Toast.makeText(context, "Album supprimé de la carte SD", Toast.LENGTH_SHORT).show()
                } finally {
                    refreshing = false
                }
            }
        }
    }

    // Un index existant permet l'affichage immédiat sans aucun scan au démarrage.
    // Pour découvrir de nouveaux morceaux ou une carte SD modifiée, utiliser SCAN.
    // Le premier lancement sans index conserve le scan complet et sa barre de progression.
    var startupScanInProgress by remember { mutableStateOf(false) }
    LaunchedEffect(permissionGranted) {
        if (permissionGranted) {
            loading = true
            try {
                val cachedAlbums = repository.cachedAlbumsFromSdMusic()
                if (cachedAlbums.isNotEmpty()) {
                    albums = cachedAlbums
                    playlists = repository.listPlaylists()
                    // Ne pas relancer quickRefreshAlbumsFromSdMusic à chaque ouverture :
                    // des milliers de fichiers MediaStore peuvent être signalés "modifiés".
                } else {
                    startupScanInProgress = true
                    scanProgress = 0f
                    // Premier lancement : un seul passage MediaStore.
                    // Pas de relecture MP3/FLAC et pas de requêtes par paquets d'IDs.
                    val indexedAlbums = repository.fastBootstrapAlbumsFromMediaStore { progress ->
                        withContext(Dispatchers.Main) {
                            scanProgress = progress.coerceIn(0f, 1f)
                        }
                    }
                    albums = indexedAlbums
                    playlists = repository.listPlaylists()
                    scanProgress = 1f
                }
            } finally {
                loading = false
                if (startupScanInProgress) delay(250L)
                startupScanInProgress = false
                scanProgress = null
            }
        }
    }

    LaunchedEffect(Unit) {
        if (!permissionGranted) {
            permissionLauncher.launch(requiredAudioPermission())
        }
    }

    // Certains launchers/lecteurs de voiture recuperent le morceau actif via la
    // notification media. Sur Android 13+, on demande donc explicitement son autorisation.
    LaunchedEffect(permissionGranted) {
        if (
            permissionGranted &&
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    var filteredAlbums by remember { mutableStateOf<List<Album>>(emptyList()) }

    LaunchedEffect(albums, search) {
        if (search.isBlank()) {
            searching = false
            filteredAlbums = albums
        } else {
            searching = true
            delay(100L)
            val query = search.trim()
            filteredAlbums = withContext(Dispatchers.Default) {
                albums.filter { album ->
                    album.title.contains(query, ignoreCase = true) ||
                        album.artist.contains(query, ignoreCase = true) ||
                        album.genre.contains(query, ignoreCase = true) ||
                        album.releaseDate.contains(query, ignoreCase = true) ||
                        album.tracks.any { track ->
                            track.title.contains(query, ignoreCase = true) ||
                                track.artist.contains(query, ignoreCase = true) ||
                                track.albumArtist.contains(query, ignoreCase = true) ||
                                track.composer.contains(query, ignoreCase = true)
                        }
                }
            }
            searching = false
        }
    }

    val displayedAlbums = remember(filteredAlbums, librarySortMode, genreCategory) {
        if (librarySortMode != "genre") {
            filteredAlbums
        } else {
            filteredAlbums.filter { album -> albumMatchesGenreCategory(album, genreCategory) }
        }
    }

    val displayedLibraryCount = remember(albums, librarySortMode, genreCategory) {
        if (librarySortMode != "genre") {
            albums.size
        } else {
            albums.count { album -> albumMatchesGenreCategory(album, genreCategory) }
        }
    }

    BackHandler(enabled = selectedAlbum != null) {
        selectedAlbum = null
    }

    CompositionLocalProvider(LocalUiColorProfile provides colorProfile) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF202830))
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            PlayerHeader(version = "V0.70")

        if (selectedAlbum == null) {
            if (selectedTab == 0) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    LibrarySortSelector(
                        mode = librarySortMode,
                        enabled = !loading && !refreshing && permissionGranted,
                        onArtistSelected = { librarySortMode = "artist" },
                        onGenresClick = { genreMenuOpen = true },
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.size(4.dp))
                    SearchIconButton(
                        active = search.isNotBlank(),
                        enabled = !loading && !refreshing && permissionGranted,
                        onClick = { searchDialogOpen = true }
                    )
                    Spacer(Modifier.size(4.dp))
                    DisplayModeSelector(
                        columns = gridColumns,
                        enabled = !loading && !refreshing && permissionGranted,
                        onColumnsSelected = { gridColumns = it }
                    )
                }

                Box(modifier = Modifier.weight(1f)) {
                    when {
                        !permissionGranted -> CenterMessage("Autorise l’accès à la musique")
                        loading && albums.isEmpty() -> StartupLoadingBar(progress = scanProgress)
                        albums.isEmpty() -> CenterMessage("Aucun MP3/FLAC trouvé dans la carte SD / Music")
                        displayedAlbums.isEmpty() -> CenterMessage("Aucun résultat")
                        else -> AlbumGrid(
                            albums = displayedAlbums,
                            libraryAlbumCount = displayedLibraryCount,
                            repository = repository,
                            columns = gridColumns,
                            gridState = libraryGridState,
                            groupMode = librarySortMode,
                            artworkRevision = coverRevision,
                            onAlbumLongPress = { album -> coverActionAlbum = album },
                            onAlbumClick = { album ->
                                // Un clic simple lance la lecture et ouvre la liste des morceaux.
                                selectedAlbum = album
                                val activeController = controller ?: return@AlbumGrid

                                val currentMetadata = activeController.currentMediaItem?.mediaMetadata
                                val sameAlbum = activeController.mediaItemCount > 0 &&
                                    currentMetadata?.albumTitle?.toString().orEmpty().equals(album.title, ignoreCase = true) &&
                                    currentMetadata?.albumArtist?.toString().orEmpty().equals(album.artist, ignoreCase = true)

                                // Lecture directe sans quitter la grille des pochettes.
                                if (sameAlbum) {
                                    if (!activeController.isPlaying) activeController.play()
                                    return@AlbumGrid
                                }

                                coroutineScope.launch {
                                    val artwork = repository.albumArtworkBytes(album)
                                    val items = album.tracks.map { track ->
                                        MediaItem.Builder()
                                            .setUri(track.uri)
                                            .setMediaId(track.uri.toString())
                                            .setMediaMetadata(
                                                MediaMetadata.Builder()
                                                    .setTitle(track.title)
                                                    .setDisplayTitle(track.title)
                                                    .setArtist(track.artist)
                                                    .setSubtitle(track.artist)
                                                    .setAlbumTitle(album.title)
                                                    .setAlbumArtist(album.artist)
                                                    .setDescription(album.title)
                                                    .setComposer(track.composer.takeIf { it.isNotBlank() })
                                                    .setDurationMs(track.durationMs.takeIf { it > 0L })
                                                    .setTrackNumber(track.trackNumber.takeIf { it > 0 })
                                                    .apply {
                                                        if (artwork != null) {
                                                            setArtworkData(
                                                                artwork,
                                                                MediaMetadata.PICTURE_TYPE_FRONT_COVER
                                                            )
                                                        }
                                                    }
                                                    .build()
                                            )
                                            .build()
                                    }
                                    activeController.setMediaItems(items, 0, 0L)
                                    activeController.prepare()
                                    activeController.play()
                                }
                            }
                        )
                    }

                    RefreshLibraryButton(
                        enabled = !loading && !refreshing && permissionGranted,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(start = 16.dp, bottom = 16.dp),
                        onClick = {
                            coroutineScope.launch {
                                refreshing = true
                                scanProgress = 0f
                                try {
                                    val beforeKeys = albums.mapTo(mutableSetOf()) { it.key }
                                    val refreshed = repository.quickRefreshAlbumsFromSdMusic { progress ->
                                        withContext(Dispatchers.Main) {
                                            scanProgress = progress.coerceIn(0f, 1f)
                                        }
                                    }
                                    scanProgress = 1f
                                    val newCount = refreshed.count { it.key !in beforeKeys }
                                    albums = refreshed
                                    playlists = repository.listPlaylists()
                                    Toast.makeText(
                                        context,
                                        if (newCount > 0) "$newCount nouvel album détecté" else "Aucune nouveauté détectée",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } finally {
                                    delay(180)
                                    scanProgress = null
                                    refreshing = false
                                }
                            }
                        }
                    )
                }
            } else {
                SendScreen(
                    albums = albums,
                    selectedAlbums = sendAlbums,
                    repository = repository,
                    artworkRevision = coverRevision,
                    modifier = Modifier.weight(1f),
                    onOpenPicker = { sendPickerOpen = true },
                    onRemoveAlbum = { album -> sendAlbums = sendAlbums.filterNot { it.key == album.key } },
                    onSend = {
                        if (sendAlbums.isEmpty()) {
                            Toast.makeText(context, "Ajoute au moins un album", Toast.LENGTH_SHORT).show()
                        } else {
                            sendAlbumsToA34g(context, sendAlbums)
                        }
                    }
                )
            }
        } else {
            PlaylistScreen(
                album = selectedAlbum!!,
                repository = repository,
                controller = controller,
                artworkRevision = coverRevision,
                modifier = Modifier.weight(1f),
                onBack = { selectedAlbum = null },
                onCoverLongPress = { coverActionAlbum = selectedAlbum }
            )
        }

            if (controller != null) {
                PlayerBar(controller = controller!!)
            }
        }

        if (searchDialogOpen) {
            SearchDialog(
                value = search,
                onValueChange = { search = it },
                onDismiss = { searchDialogOpen = false },
                onClear = { search = "" }
            )
        }

        if (genreMenuOpen) {
            GenreCategoryDialog(
                selected = genreCategory,
                onSelect = { category ->
                    genreCategory = category
                    librarySortMode = "genre"
                    genreMenuOpen = false
                },
                onDismiss = { genreMenuOpen = false }
            )
        }

        val activeScanProgress = scanProgress
        if (activeScanProgress != null) {
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Color(0xE6111111))
                    .padding(horizontal = 14.dp, vertical = 7.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (startupScanInProgress) "Vérification de la bibliothèque" else "Scan de la bibliothèque",
                        color = Color(0xFFEDEDED),
                        fontSize = 11.sp
                    )
                    Text(
                        text = "${(activeScanProgress * 100f).toInt().coerceIn(0, 100)} %",
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { activeScanProgress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp),
                    color = colorProfile.primary,
                    trackColor = colorProfile.secondary.copy(alpha = 0.18f)
                )
            }
        } else if ((loading && albums.isNotEmpty()) || refreshing || searching) {
            LinearProgressIndicator(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(3.dp),
                color = colorProfile.primary,
                trackColor = colorProfile.secondary.copy(alpha = 0.18f)
            )
        }
    }

    if (sendPickerOpen) {
        SendAlbumPickerDialog(
            albums = albums,
            initiallySelected = sendAlbums,
            maxAlbums = 10,
            onDismiss = { sendPickerOpen = false },
            onConfirm = { chosen ->
                sendAlbums = chosen
                sendPickerOpen = false
            }
        )
    }

    coverActionAlbum?.let { album ->
        CoverActionDialog(
            album = album,
            onDismiss = { coverActionAlbum = null },
            onSuggestions = {
                coverActionAlbum = null
                suggestionAlbum = album
            },
            onEditMetadata = {
                coverActionAlbum = null
                metadataEditAlbum = album
            },
            onAddToPlaylist = {
                coverActionAlbum = null
                playlistTargetAlbum = album
            },
            onHideAlbum = {
                coverActionAlbum = null
                hideConfirmAlbum = album
            },
            onDeleteAlbum = {
                coverActionAlbum = null
                deleteConfirmAlbum = album
            },
            onMergeAlbums = {
                coverActionAlbum = null
                mergeTargetAlbum = album
            },
            onUnmergeAlbums = {
                coverActionAlbum = null
                coroutineScope.launch {
                    val wasSelected = selectedAlbum?.key == album.key
                    val success = repository.unmergeAlbum(album)
                    if (success) {
                        refreshing = true
                        try {
                            albums = repository.quickRefreshAlbumsFromSdMusic()
                            coverRevision += 1
                            if (wasSelected) selectedAlbum = null
                            Toast.makeText(context, "Albums séparés", Toast.LENGTH_SHORT).show()
                        } finally {
                            refreshing = false
                        }
                    }
                }
            },
            onPasteClipboard = {
                coverActionAlbum = null
                coroutineScope.launch {
                    val success = repository.saveCustomArtworkFromClipboard(album)
                    if (success) {
                        coverCache.remove(album.key)
                        coverRevision += 1
                        Toast.makeText(context, "Pochette collée", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(
                            context,
                            "Le presse-papiers ne contient pas d’image ou de lien utilisable",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            },
            onPasteReference = {
                coverActionAlbum = null
                referenceAlbum = album
                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                val clip = clipboard?.primaryClip
                referenceInitialText = clip
                    ?.takeIf { it.itemCount > 0 }
                    ?.getItemAt(0)
                    ?.coerceToText(context)
                    ?.toString()
                    .orEmpty()
            },
            onChooseImage = {
                coverActionAlbum = null
                imagePickerAlbum = album
                imagePickerLauncher.launch("image/*")
            },
            onReset = {
                coverActionAlbum = null
                coroutineScope.launch {
                    repository.clearCustomArtwork(album)
                    coverCache.remove(album.key)
                    coverRevision += 1
                }
            }
        )
    }

    suggestionAlbum?.let { album ->
        ArtworkSuggestionsDialog(
            album = album,
            repository = repository,
            onDismiss = { suggestionAlbum = null },
            onSelect = { suggestion ->
                suggestionAlbum = null
                coroutineScope.launch {
                    if (repository.saveCustomArtwork(album, suggestion.bytes)) {
                        coverCache.remove(album.key)
                        coverRevision += 1
                    }
                }
            }
        )
    }

    referenceAlbum?.let { album ->
        ArtworkReferenceDialog(
            album = album,
            repository = repository,
            initialText = referenceInitialText,
            onDismiss = {
                referenceAlbum = null
                referenceInitialText = ""
            },
            onApplied = { suggestion ->
                coroutineScope.launch {
                    if (repository.saveCustomArtwork(album, suggestion.bytes)) {
                        coverCache.remove(album.key)
                        coverRevision += 1
                    }
                }
                referenceAlbum = null
                referenceInitialText = ""
            }
        )
    }

    metadataEditAlbum?.let { album ->
        EditAlbumMetadataDialog(
            album = album,
            onDismiss = { metadataEditAlbum = null },
            onSave = { title, artist, date ->
                metadataEditAlbum = null
                coroutineScope.launch {
                    val updated = repository.saveAlbumMetadata(album, title, artist, date)
                    albums = albums
                        .map { if (it.key == album.key) updated else it }
                        .sortedWith(
                            compareBy<Album> { it.title.lowercase() }
                                .thenBy { it.artist.lowercase() }
                        )
                    if (selectedAlbum?.key == album.key) selectedAlbum = updated
                    coverCache.remove(album.key)
                    coverRevision += 1
                    Toast.makeText(context, "Informations de l’album enregistrées", Toast.LENGTH_SHORT).show()
                }
            },
            onReset = {
                metadataEditAlbum = null
                coroutineScope.launch {
                    repository.clearAlbumMetadata(album)
                    loading = true
                    albums = repository.quickRefreshAlbumsFromSdMusic()
                    playlists = repository.listPlaylists()
                    if (selectedAlbum?.key == album.key) {
                        selectedAlbum = albums.firstOrNull { it.key == album.key }
                    }
                    loading = false
                    coverCache.remove(album.key)
                    coverRevision += 1
                }
            }
        )
    }

    playlistTargetAlbum?.let { album ->
        PlaylistPickerDialog(
            album = album,
            playlists = playlists,
            onDismiss = { playlistTargetAlbum = null },
            onSelect = { playlist ->
                playlistTargetAlbum = null
                coroutineScope.launch {
                    val added = repository.addAlbumToPlaylist(album, playlist.name)
                    playlists = repository.listPlaylists()
                    if (added) {
                        Toast.makeText(context, "Album rangé dans la playlist ${playlist.name}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        )
    }

    mergeTargetAlbum?.let { album ->
        MergeAlbumsDialog(
            baseAlbum = album,
            albums = albums,
            onDismiss = { mergeTargetAlbum = null },
            onMerge = { selectedOthers ->
                mergeTargetAlbum = null
                coroutineScope.launch {
                    val wasInPlaylistView = selectedAlbum != null
                    refreshing = true
                    try {
                        val mergedKey = repository.mergeAlbums(album, selectedOthers)
                        if (mergedKey != null) {
                            albums = repository.quickRefreshAlbumsFromSdMusic()
                            coverRevision += 1
                            if (wasInPlaylistView) {
                                selectedAlbum = albums.firstOrNull { it.key == mergedKey }
                            }
                            Toast.makeText(context, "Albums fusionnés", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "Choisis au total 2 ou 3 albums", Toast.LENGTH_SHORT).show()
                        }
                    } finally {
                        refreshing = false
                    }
                }
            }
        )
    }

    hideConfirmAlbum?.let { album ->
        AlertDialog(
            onDismissRequest = { hideConfirmAlbum = null },
            containerColor = Color(0xFF171717),
            titleContentColor = Color(0xFFF2F2F2),
            textContentColor = Color(0xFFD0D0D0),
            title = { Text("Retirer cet album ?", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "${album.title} sera retiré de la bibliothèque d’albums MerylCarPlayer. Les morceaux restent sur le téléphone et ne sont pas supprimés.",
                    fontSize = 14.sp
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        hideConfirmAlbum = null
                        coroutineScope.launch {
                            repository.hideAlbum(album)
                            albums = albums.filterNot { it.key == album.key }
                            if (selectedAlbum?.key == album.key) selectedAlbum = null
                            Toast.makeText(context, "Album retiré de la bibliothèque", Toast.LENGTH_SHORT).show()
                        }
                    }
                ) {
                    Text("Retirer", color = Color(0xFFE0A0A0))
                }
            },
            dismissButton = {
                TextButton(onClick = { hideConfirmAlbum = null }) {
                    Text("Annuler", color = Color(0xFFD0D0D0))
                }
            }
        )
    }


    deleteConfirmAlbum?.let { album ->
        AlertDialog(
            onDismissRequest = { deleteConfirmAlbum = null },
            containerColor = Color(0xFF171717),
            titleContentColor = Color(0xFFF2F2F2),
            textContentColor = Color(0xFFD0D0D0),
            title = { Text("Supprimer définitivement cet album ?", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "${album.title} : ${album.tracks.size} morceau${if (album.tracks.size > 1) "x" else ""} ${if (album.tracks.size > 1) "seront supprimés" else "sera supprimé"} de la carte SD. Cette action ne peut pas être annulée.",
                    fontSize = 14.sp
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteConfirmAlbum = null
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            val uris = album.tracks.map { it.uri }.distinct()
                            if (uris.isNotEmpty()) {
                                runCatching {
                                    val pendingIntent = MediaStore.createDeleteRequest(context.contentResolver, uris)
                                    deletePendingAlbum = album
                                    deleteAlbumLauncher.launch(
                                        IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                                    )
                                }.onFailure {
                                    deletePendingAlbum = null
                                    Toast.makeText(context, "Impossible de demander la suppression", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            Toast.makeText(context, "La suppression directe nécessite Android 11 ou plus", Toast.LENGTH_LONG).show()
                        }
                    }
                ) {
                    Text("SUPPRIMER", color = Color(0xFFFF7D7D), fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteConfirmAlbum = null }) {
                    Text("Annuler", color = Color(0xFFD0D0D0))
                }
            }
        )
    }
    }
}

@Composable
private fun PlayerHeader(version: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .zIndex(1f)
            .background(Color(0xFF202830))
            .padding(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Affichage texte provisoire pour isoler un éventuel plantage du décodage d'image.
        Text(
            text = "MERYL CAR AUDIO",
            modifier = Modifier.weight(1f),
            color = Color(0xFFFFDE59),
            fontSize = 20.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1
        )

        Text(
            text = version,
            color = Color(0xFFDCE3E8),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 8.dp)
        )
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(3.dp)
            .zIndex(0f)
            .background(Color(0xFFFFDE59))
    )
}

@Composable
private fun ColorProfileDialog(
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xFF141A20))
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "PROFIL DE COULEUR",
                color = Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )

            UiColorProfiles.forEachIndexed { index, profile ->
                val selected = index == selectedIndex
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (selected) profile.primary else Color(0xFF202830))
                        .clickable { onSelect(index) }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${index + 1} · ${profile.name}",
                        color = if (selected) profile.onPrimary else Color.White,
                        fontSize = 13.sp,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier.weight(1f)
                    )

                    listOf(
                        profile.primary,
                        profile.secondary,
                        profile.accent,
                        profile.detail
                    ).forEach { swatch ->
                        Box(
                            modifier = Modifier
                                .padding(start = 4.dp)
                                .size(width = 15.dp, height = 18.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(swatch)
                        )
                    }
                }
            }

            Text(
                text = "Le fond reste #202830. Les couleurs du logo changent de rôle.",
                color = Color(0xFFAEB9C0),
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 3.dp)
            )
        }
    }
}

@Composable
private fun StartupLoadingBar(progress: Float?) {
    val profile = LocalUiColorProfile.current
    val currentProgress = progress?.coerceIn(0f, 1f)
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth(0.78f)
        ) {
            Text(
                text = "Chargement de la bibliothèque",
                color = Color.White,
                fontSize = 14.sp
            )
            if (currentProgress != null) {
                LinearProgressIndicator(
                    progress = { currentProgress },
                    modifier = Modifier.fillMaxWidth().height(6.dp),
                    color = profile.primary,
                    trackColor = profile.secondary.copy(alpha = 0.18f)
                )
                Text(
                    text = "${(currentProgress * 100f).toInt()} %",
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            } else {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(6.dp),
                    color = profile.primary,
                    trackColor = profile.secondary.copy(alpha = 0.18f)
                )
            }
        }
    }
}

@Composable
private fun MainTabs(
    selectedTab: Int,
    onSelect: (Int) -> Unit
) {
    val profile = LocalUiColorProfile.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF0A0A0A))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        listOf("Albums", "Envoi").forEachIndexed { index, label ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(38.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (selectedTab == index) profile.primary else Color(0xFF151515)
                    )
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = label,
                    color = if (selectedTab == index) profile.onPrimary else Color(0xFFA8A8A8),
                    fontSize = 15.sp,
                    fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun SendScreen(
    albums: List<Album>,
    selectedAlbums: List<Album>,
    repository: MusicRepository,
    artworkRevision: Int,
    modifier: Modifier = Modifier,
    onOpenPicker: () -> Unit,
    onRemoveAlbum: (Album) -> Unit,
    onSend: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(
                modifier = Modifier
                    .weight(0.9f)
                    .fillMaxSize()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF111A21))
                    .padding(12.dp)
            ) {
                Text(
                    text = "Samsung A34g",
                    color = Color(0xFFF2F2F2),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF17242C))
                        .clickable(onClick = onOpenPicker)
                        .padding(12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "+",
                            color = Color(0xFFE8F1F5),
                            fontSize = 34.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "Coller le ou les LPs ici",
                            color = Color(0xFFE8F1F5),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "Touchez pour choisir jusqu’à 10 albums",
                            color = Color(0xFF93A4AE),
                            fontSize = 11.sp,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                }
            }

            Column(
                modifier = Modifier
                    .weight(1.1f)
                    .fillMaxSize()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color(0xFF151515))
                    .padding(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Albums collés",
                        color = Color(0xFFF2F2F2),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = "${selectedAlbums.size}/10",
                        color = if (selectedAlbums.size >= 10) Color(0xFFFFB0B0) else Color(0xFF9AA7AD),
                        fontSize = 12.sp
                    )
                }

                Spacer(Modifier.height(7.dp))

                if (selectedAlbums.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clickable(onClick = onOpenPicker),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Aucun album",
                            color = Color(0xFF727272),
                            fontSize = 13.sp
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(7.dp)
                    ) {
                        itemsIndexed(selectedAlbums, key = { _, album -> album.key }) { _, album ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(Color(0xFF202020))
                                    .padding(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                AlbumCover(
                                    album = album,
                                    repository = repository,
                                    artworkRevision = artworkRevision,
                                    modifier = Modifier
                                        .size(46.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                )
                                Spacer(Modifier.size(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = album.title,
                                        color = Color(0xFFF0F0F0),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = album.artist,
                                        color = Color(0xFF9D9D9D),
                                        fontSize = 10.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                Text(
                                    text = "×",
                                    color = Color(0xFFD0D0D0),
                                    fontSize = 24.sp,
                                    modifier = Modifier
                                        .clickable { onRemoveAlbum(album) }
                                        .padding(horizontal = 5.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(15.dp))
                .background(if (selectedAlbums.isNotEmpty()) Color(0xFF244B35) else Color(0xFF171717))
                .clickable(enabled = selectedAlbums.isNotEmpty(), onClick = onSend),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Envoyer à A34g",
                color = if (selectedAlbums.isNotEmpty()) Color(0xFFF3FFF6) else Color(0xFF5B5B5B),
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun SendAlbumPickerDialog(
    albums: List<Album>,
    initiallySelected: List<Album>,
    maxAlbums: Int,
    onDismiss: () -> Unit,
    onConfirm: (List<Album>) -> Unit
) {
    var selectedKeys by remember(initiallySelected, albums) {
        mutableStateOf(initiallySelected.map { it.key }.toSet())
    }
    val sortedAlbums = remember(albums) {
        albums.sortedWith(
            compareBy<Album> { it.artist.lowercase() }
                .thenBy { it.title.lowercase() }
        )
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(620.dp),
            shape = RoundedCornerShape(18.dp),
            color = Color(0xFF111111)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text(
                    text = "Choisir les LPs",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${selectedKeys.size}/$maxAlbums sélectionnés",
                    color = Color(0xFF9E9E9E),
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(10.dp))

                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    itemsIndexed(sortedAlbums, key = { _, album -> album.key }) { _, album ->
                        val selected = album.key in selectedKeys
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (selected) Color(0xFF20392A) else Color(0xFF1A1A1A))
                                .clickable {
                                    selectedKeys = when {
                                        selected -> selectedKeys - album.key
                                        selectedKeys.size < maxAlbums -> selectedKeys + album.key
                                        else -> selectedKeys
                                    }
                                }
                                .padding(horizontal = 10.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (selected) "✓" else "○",
                                color = if (selected) Color(0xFFB9F4C9) else Color(0xFF777777),
                                fontSize = 19.sp,
                                modifier = Modifier.size(28.dp)
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = album.title,
                                    color = Color(0xFFF1F1F1),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = album.artist,
                                    color = Color(0xFF999999),
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Annuler", color = Color(0xFFBDBDBD))
                    }
                    TextButton(
                        onClick = {
                            val chosen = sortedAlbums.filter { it.key in selectedKeys }.take(maxAlbums)
                            onConfirm(chosen)
                        }
                    ) {
                        Text("Coller", color = Color(0xFFB9F4C9), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

private fun sendAlbumsToA34g(context: Context, albums: List<Album>) {
    val uris = albums
        .take(10)
        .flatMap { album -> album.tracks.map { it.uri } }
        .distinct()

    if (uris.isEmpty()) {
        Toast.makeText(context, "Aucun fichier audio à envoyer", Toast.LENGTH_SHORT).show()
        return
    }

    val shareIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = "audio/*"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList<Uri>(uris))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newUri(context.contentResolver, "Albums MerylCarPlayer", uris.first()).also { clip ->
            uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
        }
    }

    val chooser = Intent.createChooser(shareIntent, "Envoyer à Samsung A34g")
    context.startActivity(chooser)
}

@Composable
private fun SearchIconButton(
    active: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val profile = LocalUiColorProfile.current
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(
                when {
                    active -> profile.secondary
                    enabled -> Color(0xFF151515)
                    else -> Color(0xFF101010)
                }
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "⌕",
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = when {
                !enabled -> Color(0xFF555555)
                active -> if (profile.secondary == Color.White || profile.secondary == Color(0xFFFFDE59)) Color(0xFF202830) else Color.White
                else -> Color(0xFFB8B8B8)
            }
        )
    }
}

@Composable
private fun SearchDialog(
    value: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onClear: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        title = {
            Text(
                text = "Rechercher",
                color = Color(0xFFF2F2F2),
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            SearchBar(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("OK", color = Color(0xFFB9D7E3))
            }
        },
        dismissButton = {
            if (value.isNotBlank()) {
                TextButton(
                    onClick = {
                        onClear()
                        onDismiss()
                    }
                ) {
                    Text("Effacer", color = Color(0xFFBDBDBD))
                }
            }
        }
    )
}

@Composable
private fun SearchBar(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .height(52.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0xFF151515))
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("⌕", fontSize = 27.sp, color = Color(0xFFB8B8B8))
        Spacer(Modifier.size(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 18.sp, color = Color(0xFFF2F2F2)),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text("Rechercher", fontSize = 18.sp, color = Color(0xFF858585))
                    }
                    inner()
                }
            }
        )
        if (value.isNotEmpty()) {
            Text(
                "×",
                fontSize = 28.sp,
                color = Color(0xFFB8B8B8),
                modifier = Modifier
                    .clickable { onValueChange("") }
                    .padding(4.dp)
            )
        }
    }
}

@Composable
private fun RefreshLibraryButton(
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val profile = LocalUiColorProfile.current
    Box(
        modifier = modifier
            .size(54.dp)
            .clip(RoundedCornerShape(27.dp))
            .background(if (enabled) profile.secondary else Color(0xFF171717))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "↻",
            color = if (enabled) {
                if (profile.secondary == Color.White || profile.secondary == Color(0xFFFFDE59)) Color(0xFF202830) else Color.White
            } else Color(0xFF666666),
            fontSize = 31.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun LibrarySortSelector(
    mode: String,
    enabled: Boolean,
    onArtistSelected: () -> Unit,
    onGenresClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val profile = LocalUiColorProfile.current
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF151515))
            .padding(2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        val homeSelected = mode == "artist"
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(
                    when {
                        homeSelected -> profile.primary
                        enabled -> Color.Transparent
                        else -> Color(0xFF101010)
                    }
                )
                .clickable(enabled = enabled) { onArtistSelected() },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "⌂",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = when {
                    !enabled -> Color(0xFF555555)
                    homeSelected -> profile.onPrimary
                    else -> Color(0xFF9A9A9A)
                },
                maxLines = 1,
                textAlign = TextAlign.Center
            )
        }

        val genreSelected = mode == "genre"
        Box(
            modifier = Modifier
                .weight(1f)
                .height(38.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(
                    when {
                        genreSelected -> profile.primary
                        enabled -> Color.Transparent
                        else -> Color(0xFF101010)
                    }
                )
                .clickable(enabled = enabled) { onGenresClick() },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "GENRES",
                fontSize = 10.sp,
                fontWeight = if (genreSelected) FontWeight.Bold else FontWeight.Medium,
                color = when {
                    !enabled -> Color(0xFF555555)
                    genreSelected -> profile.onPrimary
                    else -> Color(0xFF9A9A9A)
                },
                maxLines = 1,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun GenreCategoryDialog(
    selected: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val profile = LocalUiColorProfile.current
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Color(0xFF151515))
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            Text(
                text = "GENRES",
                color = Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 3.dp),
                textAlign = TextAlign.Center
            )

            listOf(
                "albums" to "Albums",
                "soundtrack" to "Soundtrack",
                "podcast" to "Podcast"
            ).forEach { (value, label) ->
                val isSelected = selected == value
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(46.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background(if (isSelected) profile.primary else Color(0xFF222222))
                        .clickable { onSelect(value) },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = label,
                        color = if (isSelected) profile.onPrimary else Color(0xFFD5D5D5),
                        fontSize = 15.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                    )
                }
            }
        }
    }
}

private fun albumMatchesGenreCategory(album: Album, category: String): Boolean {
    val genre = album.genre.trim().lowercase()
    val isPodcast = genre.contains("podcast")
    val isSoundtrack = genre.contains("soundtrack") || genre == "ost"
    return when (category) {
        "soundtrack" -> isSoundtrack
        "podcast" -> isPodcast
        else -> !isSoundtrack && !isPodcast
    }
}

@Composable
private fun DisplayModeSelector(
    columns: Int,
    enabled: Boolean,
    onColumnsSelected: (Int) -> Unit
) {
    val profile = LocalUiColorProfile.current
    var expanded by remember { mutableStateOf(false) }

    Box {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (enabled) profile.accent else Color(0xFF101010))
                .clickable(enabled = enabled) { expanded = true },
            contentAlignment = Alignment.Center
        ) {
            val glyphColor = if (!enabled) {
                Color(0xFF555555)
            } else if (profile.accent == Color.White || profile.accent == Color(0xFFFFDE59)) {
                Color(0xFF202830)
            } else {
                Color.White
            }

            // Un seul bouton reste visible. Son pictogramme rappelle le mode actif.
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                repeat(columns.coerceIn(1, 4)) {
                    Box(
                        modifier = Modifier
                            .size(5.dp)
                            .clip(RoundedCornerShape(1.dp))
                            .background(glyphColor)
                    )
                }
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .clip(RoundedCornerShape(15.dp))
                .background(Color(0xFF151A1F))
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                (1..4).forEach { value ->
                    val selected = value == columns
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (selected) profile.accent else Color(0xFF273039))
                            .clickable(enabled = enabled) {
                                onColumnsSelected(value)
                                expanded = false
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        val optionColor = when {
                            !enabled -> Color(0xFF555555)
                            selected && (profile.accent == Color.White || profile.accent == Color(0xFFFFDE59)) -> Color(0xFF202830)
                            selected -> Color.White
                            else -> Color(0xFFD7DEE3)
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            repeat(value) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(RoundedCornerShape(1.dp))
                                        .background(optionColor)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlbumGrid(
    albums: List<Album>,
    libraryAlbumCount: Int,
    repository: MusicRepository,
    columns: Int,
    gridState: LazyGridState,
    groupMode: String,
    artworkRevision: Int,
    onAlbumClick: (Album) -> Unit,
    onAlbumLongPress: (Album) -> Unit
) {
    val spacing = 5.dp
    val scope = rememberCoroutineScope()

    val artistGroups = remember(albums) {
        // Regroupe également les tags avec des majuscules ou espaces différents.
        albums
            .groupBy {
                it.artist.trim().ifBlank { "Artiste inconnu" }
                    .replace(Regex("\\s+"), " ")
                    .lowercase(java.util.Locale.ROOT)
            }
            .entries
            .sortedBy { it.key }
            .map { entry ->
                val sorted = entry.value.sortedBy { it.title.lowercase(java.util.Locale.ROOT) }
                val label = sorted.firstOrNull()?.artist?.trim().orEmpty()
                    .ifBlank { "Artiste inconnu" }
                label to sorted
            }
    }

    // V0.53 : la vue Artistes n'affiche qu'une seule pochette par artiste.
    // Un double appui sur cette pochette ouvre ensuite tous les albums de l'artiste.
    var expandedArtist by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(groupMode) {
        expandedArtist = null
    }

    val artistRepresentatives = remember(artistGroups) {
        artistGroups.mapNotNull { (artist, artistAlbums) ->
            artistAlbums.firstOrNull()?.let { album -> artist to album }
        }
    }

    val expandedArtistAlbums = remember(artistGroups, expandedArtist) {
        val artist = expandedArtist
        if (artist == null) emptyList()
        else artistGroups.firstOrNull { it.first == artist }?.second.orEmpty()
    }

    LaunchedEffect(artistGroups, expandedArtist) {
        val artist = expandedArtist
        if (artist != null && artistGroups.none { it.first == artist }) {
            expandedArtist = null
        }
    }

    BackHandler(enabled = expandedArtist != null) {
        expandedArtist = null
    }

    // Chaque artiste n'apparaît qu'une fois, y compris en vue GENRES.
    // Le classement du genre dépend de l'album représentatif, mais l'appui long
    // permet de retrouver tous les albums de l'artiste dans la catégorie affichée.
    val genreGroups = remember(artistGroups) {
        artistGroups
            .groupBy { (_, artistAlbums) ->
                artistAlbums.firstOrNull()?.genre?.trim().orEmpty().ifBlank { "Autres" }
            }
            .entries
            .sortedWith(
                compareBy<Map.Entry<String, List<Pair<String, List<Album>>>>> {
                    if (it.key.equals("Autres", ignoreCase = true)) 1 else 0
                }.thenBy { it.key.lowercase(java.util.Locale.ROOT) }
            )
            .map { it.key to it.value }
    }

    val letterIndexes = remember(artistRepresentatives) {
        val result = linkedMapOf<Char, Int>()
        artistRepresentatives.forEachIndexed { index, (artist, _) ->
            val first = artist.trim().firstOrNull()?.uppercaseChar()
            if (first != null && first in 'A'..'Z' && first !in result) {
                result[first] = index
            }
        }
        result
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { expandedArtist = null }
                )
            }
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            state = gridState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = if (groupMode == "artist") 27.dp else 6.dp,
                end = if (groupMode == "artist") 27.dp else 6.dp,
                top = 34.dp,
                bottom = 5.dp
            ),
            horizontalArrangement = Arrangement.spacedBy(spacing),
            verticalArrangement = Arrangement.spacedBy(spacing)
        ) {
            // Même disposition et mêmes gestes pour ARTISTES et GENRES.
            // En GENRES, un artiste n'est affecté qu'au genre de son album représentatif.
            val visibleGroups = if (groupMode == "artist") {
                listOf("" to artistGroups)
            } else {
                genreGroups
            }
            visibleGroups.forEach { (genre, groupedArtists) ->
                if (genre.isNotEmpty()) {
                    val albumCount = groupedArtists.sumOf { (_, artistAlbums) -> artistAlbums.size }
                    item(key = "genre-header-$genre", span = { GridItemSpan(columns) }) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 9.dp, bottom = 3.dp, start = 2.dp, end = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = genre,
                                color = Color(0xFFD7B66F),
                                fontSize = 17.sp,
                                fontWeight = FontWeight.ExtraBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = "$albumCount LP${if (albumCount > 1) "s" else ""}",
                                color = Color(0xFF777777),
                                fontSize = 11.sp
                            )
                        }
                    }
                }
                groupedArtists.forEach { (artist, artistAlbums) ->
                    val representativeAlbum = artistAlbums.first()
                    val isExpandedArtist = expandedArtist == artist
                    item(key = "artist-" + representativeAlbum.key) {
                        AlbumCover(
                            album = representativeAlbum,
                            repository = repository,
                            artworkRevision = artworkRevision,
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(1f)
                                .then(
                                    if (isExpandedArtist) {
                                        Modifier
                                            .border(
                                                width = 3.dp,
                                                color = Color(0xFFFFDE59),
                                                shape = RoundedCornerShape(7.dp)
                                            )
                                            .padding(3.dp)
                                    } else {
                                        Modifier
                                    }
                                )
                                .pointerInput(artist, representativeAlbum.key, artistAlbums.size) {
                                    detectTapGestures(
                                        onTap = {
                                            if (expandedArtist != artist) expandedArtist = null
                                            onAlbumClick(representativeAlbum)
                                        },
                                        onDoubleTap = {
                                            expandedArtist = null
                                            onAlbumLongPress(representativeAlbum)
                                        },
                                        onLongPress = {
                                            expandedArtist =
                                                if (artistAlbums.size > 1 && expandedArtist != artist)
                                                    artist else null
                                        }
                                    )
                                }
                        )
                    }
                    if (expandedArtist == artist && artistAlbums.size > 1) {
                        item(
                            key = "artist-more-" + representativeAlbum.key,
                            span = { GridItemSpan(columns) }
                        ) {
                            val otherAlbums = artistAlbums.filterNot { it.key == representativeAlbum.key }
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .border(
                                        width = 2.dp,
                                        color = Color(0xFFFFDE59),
                                        shape = RoundedCornerShape(8.dp)
                                    )
                                    .background(Color(0xFFFFDE59), RoundedCornerShape(8.dp))
                                    .padding(6.dp),
                                verticalArrangement = Arrangement.spacedBy(spacing)
                            ) {
                                otherAlbums.chunked(columns * 2).forEach { rowAlbums ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(spacing)
                                    ) {
                                        rowAlbums.forEach { album ->
                                            AlbumCover(
                                                album = album,
                                                repository = repository,
                                                artworkRevision = artworkRevision,
                                                compact = true,
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .aspectRatio(1f)
                                                    .border(
                                                        width = 1.5.dp,
                                                        color = Color(0xFFFFDE59),
                                                        shape = RoundedCornerShape(5.dp)
                                                    )
                                                    .padding(2.dp)
                                                    .pointerInput(album.key) {
                                                        detectTapGestures(
                                                            onTap = {
                                                                expandedArtist = null
                                                                onAlbumClick(album)
                                                            },
                                                            onDoubleTap = {
                                                                expandedArtist = null
                                                                onAlbumLongPress(album)
                                                            }
                                                        )
                                                    }
                                            )
                                        }
                                        repeat(columns * 2 - rowAlbums.size) {
                                            Spacer(Modifier.weight(1f))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

        }

        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 5.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xCC171717))
                .padding(horizontal = 11.dp, vertical = 4.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = when {
                    groupMode == "artist" && expandedArtist != null -> {
                        val count = expandedArtistAlbums.size
                        "${expandedArtist.orEmpty()} · $count album${if (count > 1) "s" else ""}"
                    }
                    groupMode == "artist" -> {
                        val artistCount = artistRepresentatives.size
                        "$artistCount artiste${if (artistCount > 1) "s" else ""} · $libraryAlbumCount album${if (libraryAlbumCount > 1) "s" else ""}"
                    }
                    else -> "$libraryAlbumCount album${if (libraryAlbumCount > 1) "s" else ""}"
                },
                color = Color(0xFFD8D8D8),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 8.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(17.dp))
                    .background(Color(0xCC151515))
                    .clickable {
                        scope.launch {
                            scrollOneLibraryPage(gridState = gridState, direction = -1)
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Text("▲", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(17.dp))
                    .background(Color(0xCC151515))
                    .clickable {
                        scope.launch {
                            scrollOneLibraryPage(gridState = gridState, direction = 1)
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Text("▼", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }

        if (groupMode == "artist" && expandedArtist == null) {
            Column(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 2.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xCC101010))
                    .padding(horizontal = 3.dp, vertical = 2.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                ('A'..'Z').forEach { letter ->
                    val target = letterIndexes[letter]
                    Text(
                        text = letter.toString(),
                        color = if (target != null) Color(0xFFE8E8E8) else Color(0xFF4B4B4B),
                        fontSize = 9.sp,
                        fontWeight = if (target != null) FontWeight.Bold else FontWeight.Normal,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .clickable(enabled = target != null) {
                                scope.launch { gridState.scrollToItem(target ?: 0) }
                            }
                            .padding(horizontal = 3.dp, vertical = 0.dp)
                    )
                }
            }
        }
    }
}

/**
 * Déplace la bibliothèque d'une page à la fois avec une rangée de recouvrement.
 * Après le saut, la page est recentrée verticalement sur des rangées complètes :
 * aucune pochette n'est sautée ni laissée à moitié hors de la zone utile.
 */
private suspend fun scrollOneLibraryPage(gridState: LazyGridState, direction: Int) {
    val layout = gridState.layoutInfo
    if (layout.totalItemsCount <= 0) return

    val viewportStart = layout.viewportStartOffset
    val viewportEnd = layout.viewportEndOffset

    val fullyVisible = layout.visibleItemsInfo
        .filter { item ->
            val top = item.offset.y
            val bottom = top + item.size.height
            top >= viewportStart && bottom <= viewportEnd
        }

    // On travaille par rangées (même coordonnée Y) afin de rester parfaitement
    // aligné avec les pochettes, quel que soit le choix 1 / 2 / 3 / 4 colonnes.
    val rows = fullyVisible
        .groupBy { it.offset.y }
        .toSortedMap()
        .values
        .map { row -> row.minOf { it.index } }

    val target = if (direction > 0) {
        // La dernière rangée entièrement visible devient la première de la page suivante.
        // Le recouvrement est volontaire : la rangée de bord est toujours revue.
        rows.lastOrNull()
            ?: layout.visibleItemsInfo.lastOrNull()?.index
            ?: return
    } else {
        val firstRow = rows.firstOrNull()
            ?: layout.visibleItemsInfo.firstOrNull()?.index
            ?: return

        if (firstRow <= 0) {
            gridState.animateScrollToItem(0)
            centerVisibleLibraryRows(gridState)
            return
        }

        val pageSpan = if (rows.size >= 2) {
            (rows.last() - rows.first()).coerceAtLeast(1)
        } else {
            1
        }
        (firstRow - pageSpan).coerceAtLeast(0)
    }

    gridState.animateScrollToItem(target.coerceIn(0, layout.totalItemsCount - 1))
    // L'animation terminée, on recalcule la vraie géométrie de la nouvelle page
    // puis on répartit l'espace libre au-dessus et au-dessous des rangées complètes.
    centerVisibleLibraryRows(gridState)
}

/**
 * Centre verticalement le bloc de rangées entièrement visibles sans changer la cadence
 * des boutons ▲ / ▼. L'ajustement se fait sur la première rangée complète, ce qui
 * préserve l'alignement de la grille et évite toute pochette coupée.
 */
private suspend fun centerVisibleLibraryRows(gridState: LazyGridState) {
    val layout = gridState.layoutInfo
    if (layout.totalItemsCount <= 0) return

    val viewportStart = layout.viewportStartOffset
    val viewportEnd = layout.viewportEndOffset

    val fullyVisible = layout.visibleItemsInfo
        .filter { item ->
            val top = item.offset.y
            val bottom = top + item.size.height
            top >= viewportStart && bottom <= viewportEnd
        }

    if (fullyVisible.isEmpty()) return

    val rows = fullyVisible
        .groupBy { it.offset.y }
        .toSortedMap()
        .values
        .map { row ->
            val first = row.minByOrNull { it.index } ?: return@map null
            val top = row.minOf { it.offset.y }
            val bottom = row.maxOf { it.offset.y + it.size.height }
            Triple(first.index, top, bottom)
        }
        .filterNotNull()

    if (rows.isEmpty()) return

    val firstRow = rows.first()
    val lastRow = rows.last()
    val blockHeight = lastRow.third - firstRow.second
    val viewportHeight = viewportEnd - viewportStart
    val freeSpace = (viewportHeight - blockHeight).coerceAtLeast(0)
    val desiredTop = viewportStart + freeSpace / 2

    // Dans LazyGridState, un scrollOffset négatif place l'élément sous le bord
    // de départ. On utilise donc l'espace libre calculé pour centrer le bloc.
    val centeredOffset = viewportStart - desiredTop
    gridState.animateScrollToItem(
        index = firstRow.first.coerceIn(0, layout.totalItemsCount - 1),
        scrollOffset = centeredOffset
    )
}

private val coverCache = object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
}

@Composable
private fun AlbumCover(
    album: Album,
    repository: MusicRepository,
    modifier: Modifier = Modifier,
    artworkRevision: Int = 0,
    compact: Boolean = false
) {
    val bitmap by produceState<Bitmap?>(
        initialValue = coverCache.get(album.key),
        album.key,
        artworkRevision
    ) {
        if (value == null) {
            val decoded = repository.albumArtworkBitmap(album)
            if (decoded != null) coverCache.put(album.key, decoded)
            value = decoded
        }
    }

    Box(
        modifier = modifier.background(Color(0xFF151515)),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap!!.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit
            )
        } else {
            Text("♪", fontSize = if (compact) 25.sp else 52.sp, color = Color(0xFF666666))
        }

    }
}

@Composable
private fun PlaylistScreen(
    album: Album,
    repository: MusicRepository,
    controller: MediaController?,
    artworkRevision: Int,
    modifier: Modifier = Modifier,
    onBack: () -> Unit,
    onCoverLongPress: () -> Unit
) {
    var currentIndex by remember(album.key, controller) {
        mutableStateOf(controller?.currentMediaItemIndex ?: -1)
    }

    DisposableEffect(controller, album.key) {
        if (controller == null) {
            onDispose { }
        } else {
            currentIndex = controller.currentMediaItemIndex
            val listener = object : Player.Listener {
                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    currentIndex = controller.currentMediaItemIndex
                }
            }
            controller.addListener(listener)
            onDispose { controller.removeListener(listener) }
        }
    }

    val totalDuration = remember(album.key) { album.tracks.sumOf { it.durationMs } }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF111A21))
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(15.dp))
                    .background(Color(0xFF20313A))
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center
            ) {
                Text("‹", fontSize = 36.sp, color = Color(0xFFF2F2F2))
            }

            Spacer(Modifier.size(10.dp))

            AlbumCover(
                album = album,
                repository = repository,
                artworkRevision = artworkRevision,
                modifier = Modifier
                    .size(104.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .pointerInput(album.key) {
                        detectTapGestures(
                            onTap = { onCoverLongPress() },
                            onLongPress = { onCoverLongPress() }
                        )
                    }
            )

            Spacer(Modifier.size(13.dp))

            Column(modifier = Modifier.weight(1f)) {
                val albumTitleSize = when {
                    album.title.length >= 70 -> 13.sp
                    album.title.length >= 50 -> 14.sp
                    album.title.length >= 32 -> 16.sp
                    else -> 19.sp
                }
                Text(
                    text = album.title,
                    fontSize = albumTitleSize,
                    lineHeight = (albumTitleSize.value + 2).sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFE8F1F5)
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = album.artist,
                    fontSize = 15.sp,
                    color = Color(0xFF9BC5D6),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (album.releaseDate.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = album.releaseDate,
                        fontSize = 13.sp,
                        color = Color(0xFFD7B66F),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(Modifier.height(5.dp))
                Text(
                    text = buildString {
                        append(album.tracks.size)
                        append(if (album.tracks.size > 1) " titres" else " titre")
                        if (totalDuration > 0L) {
                            append("  •  ")
                            append(formatDuration(totalDuration))
                        }
                    },
                    fontSize = 13.sp,
                    color = Color(0xFF858585)
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(Color(0xFF29414B))
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0C1114)),
            contentPadding = PaddingValues(vertical = 2.dp)
        ) {
            itemsIndexed(
                items = album.tracks,
                key = { _, track -> track.uri.toString() }
            ) { index, track ->
                val active = index == currentIndex
                val artistComposer = remember(track.uri) {
                    buildString {
                        if (track.artist.isNotBlank() && !track.artist.equals("Artiste inconnu", ignoreCase = true)) {
                            append(track.artist)
                        }
                        if (track.composer.isNotBlank() && !track.composer.equals(track.artist, ignoreCase = true)) {
                            if (isNotEmpty()) append("  •  ")
                            append("Compositeur : ")
                            append(track.composer)
                        }
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            if (active) Color(0xFF243A45)
                            else if (index % 2 == 0) Color(0xFF10171B)
                            else Color(0xFF0D1316)
                        )
                        .clickable(enabled = controller != null) {
                            controller?.seekToDefaultPosition(index)
                            controller?.play()
                            currentIndex = index
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(if (active) Color(0xFF9BC5D6) else Color(0xFF1D2A31)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (active) "▶" else track.trackNumber
                                .takeIf { it != Int.MAX_VALUE }
                                ?.toString()
                                ?: (index + 1).toString(),
                            fontSize = if (active) 12.sp else 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (active) Color(0xFF071015) else Color(0xFFB8C8CF)
                        )
                    }

                    Spacer(Modifier.size(9.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = track.title,
                            fontSize = 16.sp,
                            fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold,
                            color = Color(0xFFF2F2F2),
                            maxLines = 1,
                            softWrap = false,
                            overflow = if (active) TextOverflow.Clip else TextOverflow.Ellipsis,
                            modifier = if (active) {
                                Modifier.basicMarquee(iterations = Int.MAX_VALUE)
                            } else {
                                Modifier
                            }
                        )
                        if (artistComposer.isNotBlank()) {
                            Spacer(Modifier.height(1.dp))
                            Text(
                                text = artistComposer,
                                fontSize = 12.sp,
                                color = Color(0xFF8EA4AD),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    Spacer(Modifier.size(8.dp))

                    Text(
                        text = formatDuration(track.durationMs),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color(0xFF8EA4AD)
                    )
                }
            }
        }
    }
}

@Composable
private fun CoverActionDialog(
    album: Album,
    onDismiss: () -> Unit,
    onSuggestions: () -> Unit,
    onEditMetadata: () -> Unit,
    onAddToPlaylist: () -> Unit,
    onHideAlbum: () -> Unit,
    onDeleteAlbum: () -> Unit,
    onMergeAlbums: () -> Unit,
    onUnmergeAlbums: () -> Unit,
    onPasteClipboard: () -> Unit,
    onPasteReference: () -> Unit,
    onChooseImage: () -> Unit,
    onReset: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        titleContentColor = Color(0xFFF2F2F2),
        textContentColor = Color(0xFFD0D0D0),
        title = {
            Column {
                Text("Options de l’album", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Spacer(Modifier.height(1.dp))
                Text(
                    album.title,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Normal,
                    color = Color(0xFF8F8F8F),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        },
        text = {
            Column {
                CoverMenuRow("Modifier titre / artiste / date", onEditMetadata)
                if (album.sourceAlbumKeys.size < 3) {
                    CoverMenuRow("Fusionner avec un ou deux autres albums", onMergeAlbums)
                }
                if (album.sourceAlbumKeys.size >= 2) {
                    CoverMenuRow("Dissocier les albums fusionnés", onUnmergeAlbums)
                }
                CoverMenuRow("Retirer cet album de la bibliothèque", onHideAlbum)
                CoverMenuRow("Supprimer l’album du téléphone", onDeleteAlbum, color = Color(0xFFFF8A8A))
                CoverMenuRow("Proposer des pochettes", onSuggestions)
                CoverMenuRow("Coller une image copiée", onPasteClipboard)
                CoverMenuRow("Coller l’URL d’une image / un lien", onPasteReference)
                CoverMenuRow("Choisir une image du téléphone", onChooseImage)
                CoverMenuRow("Revenir à la pochette automatique", onReset)
            }
        },
        confirmButton = {
            TextButton(
                onClick = onDismiss,
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text("Annuler", color = Color(0xFFD0D0D0), fontSize = 14.sp)
            }
        }
    )
}

@Composable
private fun CoverMenuRow(
    text: String,
    onClick: () -> Unit,
    color: Color = Color(0xFFF2F2F2)
) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        color = color,
        fontSize = 15.sp
    )
}

@Composable
private fun MergeAlbumsDialog(
    baseAlbum: Album,
    albums: List<Album>,
    onDismiss: () -> Unit,
    onMerge: (List<Album>) -> Unit
) {
    val baseCount = if (baseAlbum.sourceAlbumKeys.isNotEmpty()) baseAlbum.sourceAlbumKeys.size else 1
    var search by remember(baseAlbum.key) { mutableStateOf("") }
    var selectedKeys by remember(baseAlbum.key) { mutableStateOf<List<String>>(emptyList()) }

    val candidates = remember(albums, baseAlbum.key, search) {
        albums.filter { candidate ->
            candidate.key != baseAlbum.key &&
                (search.isBlank() ||
                    candidate.title.contains(search, ignoreCase = true) ||
                    candidate.artist.contains(search, ignoreCase = true))
        }
    }

    val selectedAlbums = selectedKeys.mapNotNull { key -> albums.firstOrNull { it.key == key } }
    val selectedSourceCount = selectedAlbums.sumOf { album ->
        if (album.sourceAlbumKeys.isNotEmpty()) album.sourceAlbumKeys.size else 1
    }
    val totalCount = baseCount + selectedSourceCount

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        titleContentColor = Color(0xFFF2F2F2),
        textContentColor = Color(0xFFD0D0D0),
        title = { Text("Fusionner des albums", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(
                    text = "Album principal : ${baseAlbum.title}",
                    color = Color(0xFFF2F2F2),
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Choisis 1 ou 2 autres albums. Le titre, l’artiste et la pochette de l’album principal seront conservés. Aucun fichier audio n’est modifié.",
                    color = Color(0xFF969696),
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(10.dp))
                BasicTextField(
                    value = search,
                    onValueChange = { search = it },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 15.sp, color = Color(0xFFF2F2F2)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF242424))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { inner ->
                        Box {
                            if (search.isBlank()) {
                                Text("Rechercher un album…", color = Color(0xFF777777), fontSize = 14.sp)
                            }
                            inner()
                        }
                    }
                )
                Spacer(Modifier.height(8.dp))

                LazyColumn(modifier = Modifier.height(300.dp)) {
                    itemsIndexed(candidates, key = { _, item -> item.key }) { _, candidate ->
                        val candidateCount = if (candidate.sourceAlbumKeys.isNotEmpty()) candidate.sourceAlbumKeys.size else 1
                        val selected = candidate.key in selectedKeys
                        val countWithoutCandidate = if (selected) totalCount - candidateCount else totalCount
                        val canSelect = selected || countWithoutCandidate + candidateCount <= 3

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable(enabled = canSelect) {
                                    selectedKeys = if (selected) {
                                        selectedKeys - candidate.key
                                    } else {
                                        selectedKeys + candidate.key
                                    }
                                }
                                .padding(horizontal = 8.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = if (selected) "✓" else "○",
                                color = if (canSelect) Color(0xFFF2F2F2) else Color(0xFF555555),
                                fontSize = 20.sp
                            )
                            Spacer(Modifier.size(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    candidate.title,
                                    color = if (canSelect) Color(0xFFF2F2F2) else Color(0xFF666666),
                                    fontSize = 15.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    candidate.artist,
                                    color = Color(0xFF858585),
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(6.dp))
                Text(
                    text = "$totalCount album${if (totalCount > 1) "s" else ""} au total",
                    color = if (totalCount in 2..3) Color(0xFFB8B8B8) else Color(0xFF777777),
                    fontSize = 12.sp
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = selectedAlbums.isNotEmpty() && totalCount in 2..3,
                onClick = { onMerge(selectedAlbums) }
            ) {
                Text(
                    "Fusionner",
                    color = if (selectedAlbums.isNotEmpty() && totalCount in 2..3) Color.White else Color(0xFF666666)
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text("Annuler", color = Color(0xFFD0D0D0), fontSize = 14.sp)
            }
        }
    )
}

@Composable
private fun PlaylistPickerDialog(
    album: Album,
    playlists: List<PlaylistSummary>,
    onDismiss: () -> Unit,
    onSelect: (PlaylistSummary) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        titleContentColor = Color(0xFFF2F2F2),
        textContentColor = Color(0xFFD0D0D0),
        title = { Text("Choisir une playlist", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(
                    text = album.title,
                    color = Color(0xFF8F8F8F),
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(10.dp))
                if (playlists.isEmpty()) {
                    Text(
                        text = "Aucune playlist existante pour l’instant.",
                        color = Color(0xFFB0B0B0),
                        fontSize = 14.sp
                    )
                } else {
                    playlists.forEach { playlist ->
                        val suffix = if (playlist.count > 0) " (${playlist.count})" else ""
                        CoverMenuRow(text = "${playlist.name}$suffix", onClick = { onSelect(playlist) })
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(if (playlists.isEmpty()) "Fermer" else "Annuler", color = Color(0xFFD0D0D0))
            }
        }
    )
}

@Composable
private fun EditAlbumMetadataDialog(
    album: Album,
    onDismiss: () -> Unit,
    onSave: (String, String, String) -> Unit,
    onReset: () -> Unit
) {
    var title by remember(album.key) { mutableStateOf(album.title) }
    var artist by remember(album.key) { mutableStateOf(album.artist) }
    var date by remember(album.key) { mutableStateOf(album.releaseDate) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        titleContentColor = Color(0xFFF2F2F2),
        title = { Text("Modifier l’album", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                AlbumMetadataField(
                    label = "Titre de l’album",
                    value = title,
                    onValueChange = { title = it }
                )
                Spacer(Modifier.height(12.dp))
                AlbumMetadataField(
                    label = "Artiste",
                    value = artist,
                    onValueChange = { artist = it }
                )
                Spacer(Modifier.height(12.dp))
                AlbumMetadataField(
                    label = "Date / année",
                    value = date,
                    onValueChange = { date = it },
                    placeholder = "Ex. 1987"
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Ces informations sont enregistrées dans MerylCarPlayer et servent aussi à la recherche des pochettes.",
                    color = Color(0xFF8F8F8F),
                    fontSize = 12.sp
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = title.isNotBlank(),
                onClick = { onSave(title, artist, date) }
            ) {
                Text("Enregistrer", color = if (title.isNotBlank()) Color.White else Color(0xFF666666))
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onReset) {
                    Text("Réinitialiser", color = Color(0xFFE0A0A0))
                }
                TextButton(onClick = onDismiss) {
                    Text("Annuler", color = Color(0xFFD0D0D0))
                }
            }
        }
    )
}

@Composable
private fun AlbumMetadataField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = ""
) {
    Column {
        Text(label, color = Color(0xFFB0B0B0), fontSize = 13.sp)
        Spacer(Modifier.height(5.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 16.sp, color = Color(0xFFF2F2F2)),
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xFF242424))
                .padding(horizontal = 12.dp, vertical = 12.dp),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isBlank() && placeholder.isNotBlank()) {
                        Text(placeholder, color = Color(0xFF6F6F6F), fontSize = 15.sp)
                    }
                    inner()
                }
            }
        )
    }
}

@Composable
private fun ArtworkSuggestionsDialog(
    album: Album,
    repository: MusicRepository,
    onDismiss: () -> Unit,
    onSelect: (ArtworkSuggestion) -> Unit
) {
    var loading by remember(album.key) { mutableStateOf(true) }
    var suggestions by remember(album.key) { mutableStateOf<List<ArtworkSuggestion>>(emptyList()) }

    LaunchedEffect(album.key) {
        loading = true
        suggestions = repository.artworkSuggestions(album, limit = 8)
        loading = false
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFF141414),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text(
                    text = "Propositions de pochettes",
                    color = Color(0xFFF2F2F2),
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = "${album.artist}  •  ${album.title}",
                    color = Color(0xFF8F8F8F),
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(12.dp))

                when {
                    loading -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(260.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = Color(0xFFF2F2F2))
                            Spacer(Modifier.height(10.dp))
                            Text("Recherche…", color = Color(0xFF9A9A9A))
                        }
                    }
                    suggestions.isEmpty() -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "Aucune autre pochette trouvée",
                            color = Color(0xFF9A9A9A),
                            fontSize = 15.sp
                        )
                    }
                    else -> LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(390.dp),
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp)
                    ) {
                        items(suggestions, key = { it.id }) { suggestion ->
                            val bitmap = remember(suggestion.id) {
                                BitmapFactory.decodeByteArray(
                                    suggestion.bytes,
                                    0,
                                    suggestion.bytes.size
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(1f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(Color(0xFF222222))
                                    .clickable(enabled = bitmap != null) { onSelect(suggestion) },
                                contentAlignment = Alignment.Center
                            ) {
                                if (bitmap != null) {
                                    Image(
                                        bitmap = bitmap.asImageBitmap(),
                                        contentDescription = "${suggestion.albumTitle} - ${suggestion.artist}",
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Fit
                                    )
                                } else {
                                    Text("♪", color = Color(0xFF777777), fontSize = 32.sp)
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("Fermer", color = Color(0xFFD0D0D0))
                }
            }
        }
    }
}

@Composable
private fun ArtworkReferenceDialog(
    album: Album,
    repository: MusicRepository,
    initialText: String,
    onDismiss: () -> Unit,
    onApplied: (ArtworkSuggestion) -> Unit
) {
    var reference by remember(album.key, initialText) { mutableStateOf(initialText) }
    var loading by remember(album.key) { mutableStateOf(false) }
    var error by remember(album.key) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF171717),
        title = {
            Text(
                "ID / lien de pochette",
                color = Color(0xFFF2F2F2),
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column {
                Text(
                    "Colle un lien ou un ID iTunes/Apple, Deezer, MusicBrainz ou Musicboard.",
                    color = Color(0xFFA0A0A0),
                    fontSize = 13.sp
                )
                Spacer(Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF252525))
                        .padding(horizontal = 12.dp, vertical = 11.dp)
                ) {
                    BasicTextField(
                        value = reference,
                        onValueChange = {
                            reference = it
                            error = null
                        },
                        singleLine = false,
                        textStyle = TextStyle(fontSize = 15.sp, color = Color(0xFFF2F2F2)),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box {
                                if (reference.isBlank()) {
                                    Text(
                                        "Ex. URL Google Images, lien direct .jpg/.png, Apple, Deezer, Musicboard…",
                                        color = Color(0xFF777777),
                                        fontSize = 13.sp
                                    )
                                }
                                inner()
                            }
                        }
                    )
                }
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, color = Color(0xFFE6A2A2), fontSize = 13.sp)
                }
                if (loading) {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = Color(0xFFF2F2F2),
                            strokeWidth = 2.dp
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("Recherche de la pochette…", color = Color(0xFF999999), fontSize = 13.sp)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = reference.isNotBlank() && !loading,
                onClick = {
                    scope.launch {
                        loading = true
                        error = null
                        val result = repository.artworkFromReference(album, reference)
                        loading = false
                        if (result != null) {
                            onApplied(result)
                        } else {
                            error = "Impossible de trouver une pochette avec cette URL, cet ID ou ce lien."
                        }
                    }
                }
            ) {
                Text("Utiliser", color = if (reference.isNotBlank() && !loading) Color.White else Color(0xFF666666))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !loading) {
                Text("Annuler", color = Color(0xFFD0D0D0))
            }
        }
    )
}

private fun formatDuration(durationMs: Long): String {
    if (durationMs <= 0L) return "--:--"
    val totalSeconds = durationMs / 1000L
    val hours = totalSeconds / 3600L
    val minutes = (totalSeconds % 3600L) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}

@Composable
private fun PlayerBar(controller: MediaController) {
    val profile = LocalUiColorProfile.current
    var isPlaying by remember { mutableStateOf(controller.isPlaying) }
    var hasPrevious by remember { mutableStateOf(controller.hasPreviousMediaItem()) }
    var hasNext by remember { mutableStateOf(controller.hasNextMediaItem()) }
    var currentTitle by remember {
        mutableStateOf(
            controller.currentMediaItem?.mediaMetadata?.displayTitle?.toString()
                ?: controller.currentMediaItem?.mediaMetadata?.title?.toString()
                ?: ""
        )
    }
    var currentArtist by remember {
        mutableStateOf(controller.currentMediaItem?.mediaMetadata?.artist?.toString().orEmpty())
    }
    var artworkBytes by remember {
        mutableStateOf(controller.currentMediaItem?.mediaMetadata?.artworkData)
    }
    var remainingMs by remember { mutableStateOf(0L) }

    val artworkBitmap = remember(artworkBytes) {
        artworkBytes?.let { bytes ->
            runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
        }
    }

    fun refreshNowPlaying() {
        val metadata = controller.currentMediaItem?.mediaMetadata
        currentTitle = metadata?.displayTitle?.toString()
            ?: metadata?.title?.toString()
            ?: ""
        currentArtist = metadata?.artist?.toString().orEmpty()
        artworkBytes = metadata?.artworkData
        hasPrevious = controller.hasPreviousMediaItem()
        hasNext = controller.hasNextMediaItem()
        val duration = controller.duration.takeIf { it > 0L } ?: metadata?.durationMs ?: 0L
        remainingMs = (duration - controller.currentPosition.coerceAtLeast(0L)).coerceAtLeast(0L)
    }

    DisposableEffect(controller) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) {
                isPlaying = value
                refreshNowPlaying()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                refreshNowPlaying()
            }

            override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
                refreshNowPlaying()
            }

            override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
                refreshNowPlaying()
            }
        }
        controller.addListener(listener)
        refreshNowPlaying()
        onDispose { controller.removeListener(listener) }
    }

    LaunchedEffect(controller, currentTitle, isPlaying) {
        while (true) {
            val metadataDuration = controller.currentMediaItem?.mediaMetadata?.durationMs ?: 0L
            val duration = controller.duration.takeIf { it > 0L } ?: metadataDuration
            remainingMs = (duration - controller.currentPosition.coerceAtLeast(0L)).coerceAtLeast(0L)
            delay(500L)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF0B1013))
            .navigationBarsPadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(38.dp)
                .background(profile.primary.copy(alpha = 0.24f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(Color(0xFF11181C)),
                contentAlignment = Alignment.Center
            ) {
                if (artworkBitmap != null) {
                    Image(
                        bitmap = artworkBitmap.asImageBitmap(),
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Text("♪", color = Color(0xFF707070), fontSize = 15.sp)
                }
            }

            Spacer(Modifier.size(7.dp))

            val nowPlaying = when {
                currentTitle.isBlank() -> "Aucune lecture"
                currentArtist.isBlank() -> currentTitle
                else -> "$currentArtist  •  $currentTitle"
            }
            Text(
                text = nowPlaying,
                color = if (currentTitle.isBlank()) Color(0xFF737373) else Color(0xFFF2F2F2),
                fontSize = 13.sp,
                fontWeight = if (currentTitle.isBlank()) FontWeight.Normal else FontWeight.SemiBold,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Clip,
                modifier = Modifier
                    .weight(1f)
                    .then(
                        if (currentTitle.isNotBlank()) Modifier.basicMarquee(iterations = Int.MAX_VALUE)
                        else Modifier
                    )
            )

            if (currentTitle.isNotBlank()) {
                Spacer(Modifier.size(8.dp))
                Text(
                    text = "-${formatDuration(remainingMs)}",
                    color = profile.secondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            BigControl("⏮", enabled = hasPrevious) { controller.seekToPreviousMediaItem() }
            BigControl(if (isPlaying) "Ⅱ" else "▶", enabled = true) {
                if (controller.isPlaying) controller.pause() else controller.play()
            }
            BigControl("⏭", enabled = hasNext) { controller.seekToNextMediaItem() }
        }
    }
}

@Composable
private fun BigControl(symbol: String, enabled: Boolean, onClick: () -> Unit) {
    val profile = LocalUiColorProfile.current
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(if (enabled) profile.primary else Color(0xFF101010))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(symbol, fontSize = 21.sp, color = if (enabled) profile.onPrimary else Color(0xFFBDBDBD))
    }
}

@Composable
private fun CenterMessage(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, modifier = Modifier.padding(24.dp), color = Color(0xFFA0A0A0), fontSize = 18.sp)
    }
}

private fun requiredAudioPermission(): String =
    if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO
    else Manifest.permission.READ_EXTERNAL_STORAGE

private fun hasAudioPermission(context: android.content.Context): Boolean =
    ContextCompat.checkSelfPermission(
        context,
        requiredAudioPermission()
    ) == PackageManager.PERMISSION_GRANTED
