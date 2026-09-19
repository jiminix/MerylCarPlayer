#!/usr/bin/env python3
"""Apply the V0.54 artist-cover and gesture update once."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
main = root / "app/src/main/java/com/nik/roadplayer/MainActivity.kt"
gradle = root / "app/build.gradle.kts"
source = main.read_text(encoding="utf-8")

if 'PlayerHeader(version = "V0.54")' in source:
    print("V0.54 already applied")
    raise SystemExit(0)
if 'PlayerHeader(version = "V0.53")' not in source:
    raise SystemExit("Unexpected application version; no files changed")

def replace_once(old, new, name):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{name}: expected 1 match, found {count}")
    source = source.replace(old, new, 1)

replace_once('PlayerHeader(version = "V0.53")',
             'PlayerHeader(version = "V0.54")', "header")

replace_once(
    "                                selectedAlbum = album\n                                if (sameAlbum) return@AlbumGrid\n",
    """                                // Lecture directe sans quitter la grille des pochettes.
                                if (sameAlbum) {
                                    if (!activeController.isPlaying) activeController.play()
                                    return@AlbumGrid
                                }
""",
    "direct playback")

replace_once(
    """    val artistGroups = remember(albums) {
        albums
            .groupBy { it.artist.trim().ifBlank { "Artiste inconnu" } }
            .entries
            .sortedBy { it.key.lowercase() }
            .map { entry -> entry.key to entry.value.sortedBy { it.title.lowercase() } }
    }
""",
    """    val artistGroups = remember(albums) {
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
""",
    "case-insensitive artist grouping")

start_marker = '''            if (groupMode == "artist") {
                val openArtist = expandedArtist
'''
end_marker = '''            } else {
                genreGroups.forEach { (genre, groupedArtists) ->
'''
if source.count(start_marker) != 1 or source.count(end_marker) != 1:
    raise SystemExit("Artist grid markers not unique; no files changed")

start = source.index(start_marker)
end = source.index(end_marker, start)
artist_grid = '''            if (groupMode == "artist") {
                artistRepresentatives.forEach { (artist, representativeAlbum) ->
                    val artistAlbums = artistGroups.firstOrNull { it.first == artist }?.second.orEmpty()
                    item(key = "artist-" + representativeAlbum.key) {
                        AlbumCover(
                            album = representativeAlbum,
                            repository = repository,
                            artworkRevision = artworkRevision,
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(1f)
                                .pointerInput(artist, representativeAlbum.key, artistAlbums.size) {
                                    detectTapGestures(
                                        onTap = { onAlbumClick(representativeAlbum) },
                                        onDoubleTap = { onAlbumLongPress(representativeAlbum) },
                                        onLongPress = {
                                            expandedArtist = if (artistAlbums.size > 1 &&
                                                expandedArtist != artist) artist else null
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
                            val otherAlbums = artistAlbums.filterNot {
                                it.key == representativeAlbum.key
                            }
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp),
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
                                                    .pointerInput(album.key) {
                                                        detectTapGestures(
                                                            onTap = { onAlbumClick(album) },
                                                            onDoubleTap = { onAlbumLongPress(album) }
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
'''
source = source[:start] + artist_grid + source[end:]

replace_once(
    """    modifier: Modifier = Modifier,
    artworkRevision: Int = 0
) {
    val bitmap by produceState<Bitmap?>(
""",
    """    modifier: Modifier = Modifier,
    artworkRevision: Int = 0,
    compact: Boolean = false
) {
    val bitmap by produceState<Bitmap?>(
""", "compact album cover")

replace_once('Text("♪", fontSize = 52.sp, color = Color(0xFF666666))',
             'Text("♪", fontSize = if (compact) 25.sp else 52.sp, color = Color(0xFF666666))',
             "compact placeholder")

config = gradle.read_text(encoding="utf-8")
assert config.count("versionCode = 52") == 1
assert config.count('versionName = "0.53"') == 1
config = config.replace("versionCode = 52", "versionCode = 53")
config = config.replace('versionName = "0.53"', 'versionName = "0.54"')

main.write_text(source, encoding="utf-8")
gradle.write_text(config, encoding="utf-8")
(root / "CHANGES_V0.54.txt").write_text(
    "MerylCarPlayer V0.54\n\n"
    "- Une seule pochette par artiste dans la vue Artistes (casse/espaces normalisés).\n"
    "- Clic simple : lecture directe, sans quitter la grille.\n"
    "- Double clic : menu de la pochette.\n"
    "- Clic long : afficher ou masquer les autres pochettes sous l'artiste, en demi-taille.\n"
    "- Clic sur une mini-pochette : lecture de cet album.\n"
    "- versionCode 53 / versionName 0.54.\n",
    encoding="utf-8"
)
print("MerylCarPlayer V0.54 source migrated")
