package com.nik.roadplayer

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Service audio principal de MerylCarPlayer.
 *
 * V0.46 : le service reste un MediaLibraryService, mais expose maintenant toute la file
 * de lecture aux launchers/lecteurs externes et maintient le widget Android synchronise
 * avec la MediaSession active.
 */
@UnstableApi
class PlaybackService : MediaLibraryService() {

    companion object {
        private const val ROOT_ID = "merylcarplayer_root"
    }

    private var mediaLibrarySession: MediaLibrarySession? = null

    private val rootItem: MediaItem by lazy {
        MediaItem.Builder()
            .setMediaId(ROOT_ID)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle("MerylCarPlayer")
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .build()
            )
            .build()
    }

    override fun onCreate() {
        super.onCreate()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        // ExoPlayer demande lui-meme un AUDIOFOCUS_GAIN. Quand la lecture MerylCarPlayer
        // demarre, l'autre lecteur audio doit donc perdre le focus et notre MediaSession
        // passe en etat PLAYING, ce que les launchers utilisent pour choisir le lecteur actif.
        val exoPlayer = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        // V0.51 : un STOP venant d'un controleur externe ne doit plus faire
        // disparaitre le morceau du lecteur principal/launcher. On transforme
        // STOP en PAUSE : le son s'arrete, mais la timeline, le morceau courant,
        // la pochette et les metadonnees restent exposes par la MediaSession.
        val player = object : ForwardingSimpleBasePlayer(exoPlayer) {
            override fun handleStop(): ListenableFuture<*> {
                getPlayer().pause()
                return Futures.immediateVoidFuture()
            }
        }

        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callback = object : MediaLibrarySession.Callback {
            override fun onGetLibraryRoot(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<MediaItem>> {
                return Futures.immediateFuture(LibraryResult.ofItem(rootItem, params))
            }

            override fun onGetItem(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                mediaId: String
            ): ListenableFuture<LibraryResult<MediaItem>> {
                if (mediaId == ROOT_ID) {
                    return Futures.immediateFuture(LibraryResult.ofItem(rootItem, null))
                }

                val player = session.player
                val match = (0 until player.mediaItemCount)
                    .asSequence()
                    .map { player.getMediaItemAt(it) }
                    .firstOrNull { it.mediaId == mediaId }

                return if (match != null) {
                    Futures.immediateFuture(LibraryResult.ofItem(asLibraryItem(match), null))
                } else {
                    Futures.immediateFuture(
                        LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
                    )
                }
            }

            override fun onGetChildren(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                parentId: String,
                page: Int,
                pageSize: Int,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
                if (parentId != ROOT_ID) {
                    return Futures.immediateFuture(
                        LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
                    )
                }

                val player = session.player
                val allItems = (0 until player.mediaItemCount)
                    .map { asLibraryItem(player.getMediaItemAt(it)) }

                val safePageSize = pageSize.coerceAtLeast(1)
                val fromIndex = (page.coerceAtLeast(0) * safePageSize).coerceAtMost(allItems.size)
                val toIndex = (fromIndex + safePageSize).coerceAtMost(allItems.size)
                val children = allItems.subList(fromIndex, toIndex)

                return Futures.immediateFuture(LibraryResult.ofItemList(children, params))
            }
        }

        mediaLibrarySession = MediaLibrarySession.Builder(this, player, callback)
            .setId("merylcarplayer_playback")
            .setSessionActivity(sessionActivity)
            .build()

        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                if (
                    events.contains(Player.EVENT_TIMELINE_CHANGED) ||
                    events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)
                ) {
                    mediaLibrarySession?.notifyChildrenChanged(
                        ROOT_ID,
                        player.mediaItemCount,
                        null
                    )
                }

                if (
                    events.contains(Player.EVENT_TIMELINE_CHANGED) ||
                    events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) ||
                    events.contains(Player.EVENT_MEDIA_METADATA_CHANGED) ||
                    events.contains(Player.EVENT_IS_PLAYING_CHANGED) ||
                    events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)
                ) {
                    MerylPlayerWidget.updateAllWidgets(this@PlaybackService, player)
                }
            }
        })

        MerylPlayerWidget.updateAllWidgets(this, player)
    }

    private fun asLibraryItem(item: MediaItem): MediaItem {
        return item.buildUpon()
            .setMediaMetadata(
                item.mediaMetadata.buildUpon()
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .build()
            )
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? {
        return mediaLibrarySession
    }

    override fun onDestroy() {
        mediaLibrarySession?.run {
            MerylPlayerWidget.updateAllWidgets(this@PlaybackService, null)
            player.release()
            release()
        }
        mediaLibrarySession = null
        super.onDestroy()
    }
}
