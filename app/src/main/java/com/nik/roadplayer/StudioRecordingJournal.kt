package com.nik.roadplayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Append-only Studio recording journal, independent from the current project. */
object StudioRecordingJournal {
    private const val PREFS = "meryl_studio_recording_journal_v1"
    @Synchronized fun record(context: Context, track: Int, durationMs: Long) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val entries = runCatching { JSONArray(prefs.getString("entries", "[]")) }.getOrDefault(JSONArray())
        entries.put(JSONObject().apply {
            put("date", System.currentTimeMillis())
            put("track", track + 1)
            put("durationMs", durationMs.coerceAtLeast(0))
        })
        prefs.edit().putString("entries", entries.toString()).commit()
    }

    fun entries(context: Context): List<JSONObject> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("entries", "[]")
        val array = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }
}

@androidx.compose.runtime.Composable
fun StudioRecordingJournalSection() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val entries = androidx.compose.runtime.remember { StudioRecordingJournal.entries(context) }
    val dateFormat = androidx.compose.runtime.remember { SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.FRANCE) }
    val monthFormat = androidx.compose.runtime.remember { SimpleDateFormat("MMMM yyyy", Locale.FRANCE) }
    androidx.compose.foundation.layout.Spacer(androidx.compose.ui.Modifier.height(androidx.compose.ui.unit.Dp(18f)))
    androidx.compose.material3.Text("Journal permanent du Studio", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
    androidx.compose.material3.Text("Nombre total d'enregistrements : ${entries.size}")
    androidx.compose.material3.Text("Temps enregistré : ${entries.sumOf { it.optLong("durationMs") } / 60000} min")
    val months = entries.groupBy { monthFormat.format(Date(it.optLong("date"))) }
    for ((month, items) in months.toList().asReversed()) {
        androidx.compose.material3.Text("$month : ${items.size} prises")
    }
    androidx.compose.foundation.layout.Spacer(androidx.compose.ui.Modifier.height(androidx.compose.ui.unit.Dp(10f)))
    androidx.compose.material3.Text("Historique des prises", style = androidx.compose.material3.MaterialTheme.typography.titleSmall)
    if (entries.isEmpty()) androidx.compose.material3.Text("Aucun enregistrement journalisé pour le moment")
    for (entry in entries.asReversed()) {
        androidx.compose.material3.Text(
            "${dateFormat.format(Date(entry.optLong("date")))} · Piste ${entry.optInt("track")} · ${entry.optLong("durationMs") / 1000} s"
        )
    }
}
