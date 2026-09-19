package com.nik.roadplayer

import android.net.Uri

data class Track(
    val id: Long,
    val uri: Uri,
    val title: String,
    val artist: String,
    val composer: String,
    val albumTitle: String,
    val albumArtist: String,
    val albumId: Long,
    val trackNumber: Int,
    val discNumber: Int,
    val durationMs: Long,
    val relativePath: String,
    val releaseDate: String = "",
    val genre: String = ""
)

data class Album(
    val key: String,
    val title: String,
    val artist: String,
    val tracks: List<Track>,
    val releaseDate: String = "",
    val genre: String = "",
    val sourceAlbumKeys: List<String> = emptyList()
)


data class ArtworkSuggestion(
    val id: String,
    val source: String,
    val albumTitle: String,
    val artist: String,
    val bytes: ByteArray
)


data class PlaylistSummary(
    val name: String,
    val count: Int = 0
)
