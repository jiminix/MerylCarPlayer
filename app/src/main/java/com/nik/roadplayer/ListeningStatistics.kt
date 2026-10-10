package com.nik.roadplayer

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.height
import androidx.media3.common.Player
import org.json.JSONObject

/**
 * Tracks actual playing time in the audio service, including background playback.
 * An item counts as one listen after 30 seconds of playback.
 */
class ListeningStatistics(private val context: Context) {
    private val preferences = context.getSharedPreferences("meryl_listening_stats_v1", Context.MODE_PRIVATE)
    private var lastTick = SystemClock.elapsedRealtime()
    private var currentId = ""
    private var currentSessionMs = 0L
    private var counted = false

    @Synchronized fun tick(player: Player) {
        val now = SystemClock.elapsedRealtime()
        val elapsed = (now - lastTick).coerceIn(0L, 15000L)
        lastTick = now
        val item = player.currentMediaItem
        val id = item?.mediaId.orEmpty().ifBlank { item?.localConfiguration?.uri?.toString().orEmpty() }
        if (id != currentId) {
            currentId = id
            currentSessionMs = 0L
            counted = false
        }
        if (!player.isPlaying || id.isBlank()) return
        val metadata = item?.mediaMetadata ?: return
        val artist = metadata.artist?.toString().orEmpty().ifBlank { "Artiste inconnu" }
        val album = metadata.albumTitle?.toString().orEmpty().ifBlank { "Album inconnu" }
        val title = metadata.title?.toString().orEmpty().ifBlank { "Titre inconnu" }
        currentSessionMs += elapsed
        val json = runCatching { JSONObject(preferences.getString("data", "{}") ?: "{}") }.getOrDefault(JSONObject())
        json.put("totalMs", json.optLong("totalMs") + elapsed)
        add(json, "artists", artist, elapsed, false)
        add(json, "albums", "$artist — $album", elapsed, false)
        val isNewListen = !counted && currentSessionMs >= 30000L
        add(json, "songs", "$artist — $title", elapsed, isNewListen)
        if (isNewListen) {
            add(json, "artists", artist, 0L, true)
            add(json, "albums", "$artist — $album", 0L, true)
            counted = true
        }
        preferences.edit().putString("data", json.toString()).apply()
    }

    private fun add(root: JSONObject, group: String, key: String, ms: Long, listen: Boolean) {
        val entries = root.optJSONObject(group) ?: JSONObject().also { root.put(group, it) }
        val entry = entries.optJSONObject(key) ?: JSONObject().also { entries.put(key, it) }
        entry.put("ms", entry.optLong("ms") + ms)
        if (listen) entry.put("plays", entry.optInt("plays") + 1)
    }
}

private fun statsDuration(ms: Long): String {
    val minutes = ms / 60000L
    return if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
}

@androidx.compose.runtime.Composable
fun ListeningStatisticsDialog(onDismiss: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val json = androidx.compose.runtime.remember {
        runCatching {
            JSONObject(context.getSharedPreferences("meryl_listening_stats_v1", Context.MODE_PRIVATE)
                .getString("data", "{}") ?: "{}")
        }.getOrDefault(JSONObject())
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { androidx.compose.material3.Text("Statistiques d'écoute") },
        text = {
            androidx.compose.foundation.layout.Column(
                modifier = androidx.compose.ui.Modifier
                    .verticalScroll(androidx.compose.foundation.rememberScrollState())
            ) {
                androidx.compose.material3.Text(
                    "Temps total : ${statsDuration(json.optLong("totalMs"))}",
                    style = androidx.compose.material3.MaterialTheme.typography.titleMedium
                )
                for ((key, heading) in listOf(
                    "artists" to "Artistes les plus écoutés",
                    "albums" to "Albums les plus écoutés",
                    "songs" to "Chansons les plus écoutées"
                )) {
                    androidx.compose.foundation.layout.Spacer(androidx.compose.ui.Modifier.height(androidx.compose.ui.unit.Dp(16f)))
                    androidx.compose.material3.Text(heading, style = androidx.compose.material3.MaterialTheme.typography.titleSmall)
                    val group = json.optJSONObject(key)
                    val entries = mutableListOf<Triple<String, Long, Int>>()
                    if (group != null) {
                        val names = group.keys()
                        while (names.hasNext()) {
                            val name = names.next()
                            val value = group.optJSONObject(name) ?: continue
                            entries.add(Triple(name, value.optLong("ms"), value.optInt("plays")))
                        }
                    }
                    if (entries.isEmpty()) androidx.compose.material3.Text("Pas encore d'écoute enregistrée")
                    entries.sortedWith(compareByDescending<Triple<String, Long, Int>> { it.second }.thenByDescending { it.third })
                        .take(10).forEachIndexed { index, entry ->
                            androidx.compose.material3.Text(
                                "${index + 1}. ${entry.first}\n${entry.third} écoutes · ${statsDuration(entry.second)}"
                            )
                        }
                }
                StudioRecordingJournalSection()
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                androidx.compose.material3.Text("Fermer")
            }
        }
    )
}
