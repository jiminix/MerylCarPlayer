package com.nik.roadplayer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.widget.RemoteViews
import androidx.media3.common.Player

/**
 * Widget Android compact de MerylCarPlayer.
 *
 * V0.50 : la derniere pochette et les dernieres metadonnees restent affichees
 * lorsque la lecture est arretee ou que la session est temporairement detruite.
 * Elles ne sont remplacees que lorsqu'un nouveau morceau devient courant dans
 * MerylCarPlayer.
 */
class MerylPlayerWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)

        // Un AppWidgetProvider est un BroadcastReceiver : il ne doit pas binder
        // directement un MediaSessionService. Le PlaybackService pousse lui-meme
        // les mises a jour quand l'etat du Player change. Ici on restaure simplement
        // le dernier morceau memorise.
        appWidgetIds.forEach { appWidgetId ->
            appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context, null))
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)

        val action = when (intent.action) {
            ACTION_PREVIOUS,
            ACTION_PLAY_PAUSE,
            ACTION_NEXT -> intent.action
            else -> null
        } ?: return

        // Ne jamais construire de MediaController ici : AppWidgetProvider herite de
        // BroadcastReceiver et Android interdit a ce contexte de binder un service.
        // On envoie donc la commande au PlaybackService, qui possede deja le Player.
        runCatching {
            context.startService(
                Intent(context, PlaybackService::class.java).apply {
                    this.action = action
                }
            )
        }.onFailure {
            // Le widget reste utilisable visuellement meme si Android refuse
            // temporairement de demarrer le service en arriere-plan.
            updateAllWidgets(context, null)
        }
    }


    companion object {
        internal const val ACTION_PREVIOUS = "com.nik.roadplayer.widget.PREVIOUS"
        internal const val ACTION_PLAY_PAUSE = "com.nik.roadplayer.widget.PLAY_PAUSE"
        internal const val ACTION_NEXT = "com.nik.roadplayer.widget.NEXT"

        private const val PREFS = "meryl_widget_last_track"
        private const val KEY_ARTIST = "artist"
        private const val KEY_ALBUM = "album"
        private const val KEY_TITLE = "title"
        private const val KEY_HAS_TRACK = "has_track"
        private const val ARTWORK_FILE = "meryl_widget_last_artwork.png"

        private data class WidgetSnapshot(
            val artist: String,
            val album: String,
            val title: String,
            val artwork: Bitmap?
        )

        fun updateAllWidgets(context: Context, player: Player?) {
            val manager = AppWidgetManager.getInstance(context)
            val component = ComponentName(context, MerylPlayerWidget::class.java)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isEmpty()) return

            val views = buildRemoteViews(context, player)
            manager.updateAppWidget(ids, views)
        }


        private fun buildRemoteViews(context: Context, player: Player?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_meryl_player)
            val currentItem = player?.currentMediaItem

            // Une nouvelle valeur n'est memorisee que s'il existe reellement un morceau
            // courant. Un STOP, la destruction du service ou une reconnexion ratee ne
            // remplacent donc jamais l'affichage par "Aucune lecture".
            val snapshot = if (currentItem != null) {
                val metadata = currentItem.mediaMetadata
                val artist = metadata.artist?.toString()
                    ?.takeIf { it.isNotBlank() }
                    ?: metadata.albumArtist?.toString()?.takeIf { it.isNotBlank() }
                    ?: "Artiste inconnu"
                val album = metadata.albumTitle?.toString()
                    ?.takeIf { it.isNotBlank() }
                    ?: "Album inconnu"
                val title = metadata.displayTitle?.toString()
                    ?.takeIf { it.isNotBlank() }
                    ?: metadata.title?.toString()?.takeIf { it.isNotBlank() }
                    ?: "Titre inconnu"

                val artwork = metadata.artworkData?.let(::decodeArtwork)
                    ?: currentItem.localConfiguration?.uri?.let { uri ->
                        decodeEmbeddedArtwork(context, uri)
                    }

                WidgetSnapshot(artist, album, title, artwork).also {
                    saveSnapshot(context, it)
                }
            } else {
                loadSnapshot(context)
            }

            if (snapshot != null) {
                views.setTextViewText(R.id.widget_artist, snapshot.artist)
                views.setTextViewText(R.id.widget_album, snapshot.album)
                views.setTextViewText(R.id.widget_title, snapshot.title)
                if (snapshot.artwork != null) {
                    views.setImageViewBitmap(R.id.widget_artwork, snapshot.artwork)
                } else {
                    views.setImageViewResource(R.id.widget_artwork, android.R.drawable.ic_media_play)
                }
            } else {
                views.setTextViewText(R.id.widget_artist, "MerylCarPlayer")
                views.setTextViewText(R.id.widget_album, "Lecteur audio")
                views.setTextViewText(R.id.widget_title, "Aucune lecture")
                views.setImageViewResource(R.id.widget_artwork, android.R.drawable.ic_media_play)
            }

            // Si le service est arrete mais que le dernier titre reste affiche, le bouton
            // devient simplement PLAY. Le titre/pochette, eux, restent en place.
            views.setImageViewResource(
                R.id.widget_play_pause,
                if (player?.isPlaying == true) android.R.drawable.ic_media_pause
                else android.R.drawable.ic_media_play
            )

            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(
                    context,
                    200,
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            views.setOnClickPendingIntent(
                R.id.widget_previous,
                widgetPendingIntent(context, 201, ACTION_PREVIOUS)
            )
            views.setOnClickPendingIntent(
                R.id.widget_play_pause,
                widgetPendingIntent(context, 202, ACTION_PLAY_PAUSE)
            )
            views.setOnClickPendingIntent(
                R.id.widget_next,
                widgetPendingIntent(context, 203, ACTION_NEXT)
            )

            return views
        }

        private fun saveSnapshot(context: Context, snapshot: WidgetSnapshot) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_HAS_TRACK, true)
                .putString(KEY_ARTIST, snapshot.artist)
                .putString(KEY_ALBUM, snapshot.album)
                .putString(KEY_TITLE, snapshot.title)
                .apply()

            runCatching {
                if (snapshot.artwork != null) {
                    context.openFileOutput(ARTWORK_FILE, Context.MODE_PRIVATE).use { output ->
                        snapshot.artwork.compress(Bitmap.CompressFormat.PNG, 100, output)
                    }
                } else {
                    context.deleteFile(ARTWORK_FILE)
                }
            }
        }

        private fun loadSnapshot(context: Context): WidgetSnapshot? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_HAS_TRACK, false)) return null

            val artist = prefs.getString(KEY_ARTIST, null)?.takeIf { it.isNotBlank() } ?: return null
            val album = prefs.getString(KEY_ALBUM, null)?.takeIf { it.isNotBlank() } ?: "Album inconnu"
            val title = prefs.getString(KEY_TITLE, null)?.takeIf { it.isNotBlank() } ?: return null
            val artwork = runCatching {
                context.openFileInput(ARTWORK_FILE).use { BitmapFactory.decodeStream(it) }
            }.getOrNull()

            return WidgetSnapshot(artist, album, title, artwork)
        }

        private fun widgetPendingIntent(
            context: Context,
            requestCode: Int,
            action: String
        ): PendingIntent {
            val intent = Intent(context, MerylPlayerWidget::class.java).apply {
                this.action = action
            }
            return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun decodeArtwork(data: ByteArray): Bitmap? {
            return runCatching {
                val original = BitmapFactory.decodeByteArray(data, 0, data.size) ?: return@runCatching null
                scaleArtwork(original)
            }.getOrNull()
        }

        private fun decodeEmbeddedArtwork(context: Context, uri: Uri): Bitmap? {
            return runCatching {
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(context, uri)
                    val bytes = retriever.embeddedPicture ?: return@runCatching null
                    val original = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@runCatching null
                    scaleArtwork(original)
                } finally {
                    retriever.release()
                }
            }.getOrNull()
        }

        private fun scaleArtwork(original: Bitmap): Bitmap {
            val maxSide = 256
            if (original.width <= maxSide && original.height <= maxSide) return original

            val ratio = minOf(
                maxSide.toFloat() / original.width.toFloat(),
                maxSide.toFloat() / original.height.toFloat()
            )
            return Bitmap.createScaledBitmap(
                original,
                (original.width * ratio).toInt().coerceAtLeast(1),
                (original.height * ratio).toInt().coerceAtLeast(1),
                true
            ).also {
                if (it !== original) original.recycle()
            }
        }
    }
}
