package com.nik.roadplayer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

private const val STUDIO_TRACK_COUNT = 3
private const val STUDIO_SAMPLE_RATE = 44100
private const val WAV_HEADER_SIZE = 44

private data class StudioMixSettings(
    val volumes: List<Float>,
    val muted: List<Boolean>,
    val solo: List<Boolean>
)

@Composable
fun StudioScreen(
    onBack: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember { MerylStudioEngine(context.applicationContext) }

    val volumes = remember { mutableStateListOf(1f, 1f, 1f) }
    val muted = remember { mutableStateListOf(false, false, false) }
    val solo = remember { mutableStateListOf(false, false, false) }
    val existing = remember { mutableStateListOf(false, false, false) }
    val durations = remember { mutableStateListOf(0L, 0L, 0L) }
    val peaks = remember {
        mutableStateListOf(
            emptyList<Float>(),
            emptyList(),
            emptyList()
        )
    }

    var recordingTrack by remember { mutableStateOf<Int?>(null) }
    var playing by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var playbackDuration by remember { mutableStateOf(0L) }
    var playbackStartOffset by remember { mutableStateOf(0L) }
    var playbackStartedAt by remember { mutableStateOf(0L) }
    var recordingStartedAt by remember { mutableStateOf(0L) }
    var playheadMs by remember { mutableStateOf(0L) }
    var pendingRecord by remember { mutableStateOf<Int?>(null) }
    var exportNameDialogOpen by remember { mutableStateOf(false) }
    var exportFileName by remember { mutableStateOf("") }

    val storedTimelineDuration = durations.maxOrNull()?.coerceAtLeast(0L) ?: 0L
    val liveRecordingDuration = if (recordingTrack != null && recordingStartedAt > 0L) {
        (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
    } else {
        0L
    }
    val timelineDuration = max(1000L, max(storedTimelineDuration, liveRecordingDuration))
    val timelineProgress = (playheadMs.toFloat() / timelineDuration.toFloat()).coerceIn(0f, 1f)

    fun settings(): StudioMixSettings = StudioMixSettings(
        volumes = volumes.toList(),
        muted = muted.toList(),
        solo = solo.toList()
    )

    fun refreshTrack(index: Int) {
        scope.launch {
            val info = withContext(Dispatchers.IO) {
                Triple(
                    engine.hasTrack(index),
                    engine.trackDurationMs(index),
                    if (index == 0) engine.trackPeaks(index, 96) else emptyList()
                )
            }
            existing[index] = info.first
            durations[index] = info.second
            peaks[index] = info.third
        }
    }

    fun beginRecording(index: Int) {
        if (recordingTrack != null) return
        playing = false
        engine.stopPlayback()
        playheadMs = 0L
        playbackStartOffset = 0L
        recordingStartedAt = SystemClock.elapsedRealtime()
        val started = engine.startRecording(index, settings())
        if (!started) {
            recordingStartedAt = 0L
            Toast.makeText(context, "Impossible de démarrer le micro", Toast.LENGTH_LONG).show()
            return
        }
        recordingTrack = index
    }

    fun requestRecord(index: Int) {
        if (ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            beginRecording(index)
        } else {
            pendingRecord = index
        }
    }

    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val track = pendingRecord
        pendingRecord = null
        if (granted && track != null) {
            beginRecording(track)
        } else if (!granted) {
            Toast.makeText(context, "Autorise le micro pour enregistrer", Toast.LENGTH_LONG).show()
        }
    }

    LaunchedEffect(pendingRecord) {
        if (pendingRecord != null &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    LaunchedEffect(Unit) {
        repeat(STUDIO_TRACK_COUNT) { refreshTrack(it) }
    }

    LaunchedEffect(playing, playbackDuration, playbackStartOffset, playbackStartedAt) {
        while (playing) {
            val elapsed = (SystemClock.elapsedRealtime() - playbackStartedAt).coerceAtLeast(0L)
            val current = playbackStartOffset + elapsed
            val end = playbackStartOffset + playbackDuration
            playheadMs = current.coerceAtMost(end)
            if (elapsed >= playbackDuration) {
                engine.stopPlayback()
                playheadMs = end.coerceAtMost(timelineDuration)
                playing = false
                break
            }
            delay(40L)
        }
    }

    LaunchedEffect(recordingTrack, recordingStartedAt) {
        while (recordingTrack != null && recordingStartedAt > 0L) {
            playheadMs = (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
            delay(40L)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            engine.stopAll()
        }
    }

    val compactBorderColors = listOf(
        Color(0xFFFF7A20),
        Color(0xFF5E7CFF)
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF10171B))
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 7.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(60.dp)
                .background(Color(0xFF202830), RoundedCornerShape(12.dp))
                .padding(horizontal = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            StudioSquareButton(
                text = "‹",
                enabled = recordingTrack == null && !exporting,
                onClick = {
                    engine.stopAll()
                    onBack()
                }
            )
            MerylBanner(
                kind = MerylBannerKind.MINI_STUDIO,
                modifier = Modifier
                    .weight(1f)
                    .height(54.dp)
                    .padding(horizontal = 4.dp)
            )
            Box(
                modifier = Modifier
                    .width(72.dp)
                    .height(32.dp)
                    .background(
                        if (recordingTrack == null && !exporting && existing.any { it })
                            Color(0xFF7E2020)
                        else Color(0xFF322428),
                        RoundedCornerShape(8.dp)
                    )
                    .clickable(
                        enabled = recordingTrack == null && !exporting && existing.any { it }
                    ) {
                        engine.stopPlayback()
                        playing = false
                        engine.deleteAllTracks()
                        repeat(STUDIO_TRACK_COUNT) { index ->
                            existing[index] = false
                            durations[index] = 0L
                            peaks[index] = emptyList()
                            volumes[index] = 1f
                            muted[index] = false
                            solo[index] = false
                        }
                        playheadMs = 0L
                        Toast.makeText(
                            context,
                            "Tous les enregistrements ont été supprimés",
                            Toast.LENGTH_SHORT
                        ).show()
                    },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "SUPPR. TOUT",
                    color = if (existing.any { it }) Color.White else Color(0xFF6E6265),
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )
            }
        }

        Spacer(Modifier.height(6.dp))

        StudioPrimaryTrack(
            hasAudio = existing[0],
            durationMs = durations[0],
            waveform = peaks[0],
            volume = volumes[0],
            muted = muted[0],
            solo = solo[0],
            recording = recordingTrack == 0,
            controlsEnabled = recordingTrack == null && !exporting,
            timelineProgress = timelineProgress,
            timelineDurationMs = timelineDuration,
            playheadMs = playheadMs,
            onTimelineSeek = { fraction ->
                if (!playing && recordingTrack == null) {
                    playheadMs = (timelineDuration * fraction.coerceIn(0f, 1f)).toLong()
                }
            },
            onVolume = { volumes[0] = it },
            onMute = { muted[0] = !muted[0] },
            onSolo = { solo[0] = !solo[0] },
            onRecord = { requestRecord(0) },
            onClear = {
                engine.deleteTrack(0)
                existing[0] = false
                durations[0] = 0L
                peaks[0] = emptyList()
                playheadMs = 0L
            }
        )

        Spacer(Modifier.height(7.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            StudioTransportButton(
                text = "⏮ DÉBUT",
                enabled = recordingTrack == null && !exporting,
                modifier = Modifier.width(72.dp)
            ) {
                engine.stopPlayback()
                playing = false
                playbackStartOffset = 0L
                playbackStartedAt = 0L
                playheadMs = 0L
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = if (playing) "■" else "▶",
                enabled = recordingTrack == null && existing.any { it } && !exporting,
                modifier = Modifier.width(70.dp)
            ) {
                if (playing) {
                    engine.stopPlayback()
                    playing = false
                } else {
                    val startAt = if (playheadMs >= storedTimelineDuration - 50L) 0L else playheadMs
                    val duration = engine.startPlayback(
                        settings = settings(),
                        startOffsetMs = startAt
                    )
                    if (duration > 0L) {
                        playbackStartOffset = startAt
                        playbackDuration = duration
                        playbackStartedAt = SystemClock.elapsedRealtime()
                        playheadMs = startAt
                        playing = true
                    }
                }
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = "■ STOP",
                enabled = recordingTrack != null || playing,
                modifier = Modifier.width(78.dp)
            ) {
                if (recordingTrack != null) {
                    val stoppedTrack = recordingTrack
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            engine.stopRecordingBlocking()
                        }
                        recordingTrack = null
                        recordingStartedAt = 0L
                        stoppedTrack?.let { refreshTrack(it) }
                    }
                } else {
                    engine.stopPlayback()
                    playing = false
                }
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = if (exporting) "MIX..." else "EXPORT",
                enabled = recordingTrack == null && existing.any { it } && !exporting,
                modifier = Modifier.width(78.dp)
            ) {
                playing = false
                engine.stopPlayback()
                exportFileName = "MerylStudio_" +
                    SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE).format(Date())
                exportNameDialogOpen = true
            }
        }

        Spacer(Modifier.height(9.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            CompactStudioTrack(
                index = 1,
                borderColor = compactBorderColors[0],
                hasAudio = existing[1],
                durationMs = durations[1],
                timelineDurationMs = timelineDuration,
                volume = volumes[1],
                muted = muted[1],
                solo = solo[1],
                recording = recordingTrack == 1,
                controlsEnabled = recordingTrack == null && !exporting,
                modifier = Modifier.weight(1f),
                onVolume = { volumes[1] = it },
                onMute = { muted[1] = !muted[1] },
                onSolo = { solo[1] = !solo[1] },
                onRecord = { requestRecord(1) },
                onClear = {
                    engine.deleteTrack(1)
                    existing[1] = false
                    durations[1] = 0L
                }
            )
            CompactStudioTrack(
                index = 2,
                borderColor = compactBorderColors[1],
                hasAudio = existing[2],
                durationMs = durations[2],
                timelineDurationMs = timelineDuration,
                volume = volumes[2],
                muted = muted[2],
                solo = solo[2],
                recording = recordingTrack == 2,
                controlsEnabled = recordingTrack == null && !exporting,
                modifier = Modifier.weight(1f),
                onVolume = { volumes[2] = it },
                onMute = { muted[2] = !muted[2] },
                onSolo = { solo[2] = !solo[2] },
                onRecord = { requestRecord(2) },
                onClear = {
                    engine.deleteTrack(2)
                    existing[2] = false
                    durations[2] = 0L
                }
            )
        }

        Spacer(Modifier.height(7.dp))

        StudioLightMetronome(modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(10.dp))
    }

    if (exportNameDialogOpen) {
        AlertDialog(
            onDismissRequest = {
                if (!exporting) exportNameDialogOpen = false
            },
            title = {
                Text(
                    text = "Nom du mix",
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                OutlinedTextField(
                    value = exportFileName,
                    onValueChange = { exportFileName = it },
                    singleLine = true,
                    label = { Text("Nom du fichier") },
                    suffix = { Text(".wav") }
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !exporting && exportFileName.trim().isNotEmpty(),
                    onClick = {
                        val requestedName = exportFileName.trim()
                        exporting = true
                        scope.launch {
                            val uri = withContext(Dispatchers.IO) {
                                engine.exportMix(settings(), requestedName)
                            }
                            exporting = false
                            exportNameDialogOpen = false
                            Toast.makeText(
                                context,
                                if (uri != null)
                                    "Mix enregistré dans Music/MerylStudio"
                                else "Export impossible",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                ) {
                    Text(if (exporting) "EXPORT..." else "EXPORTER")
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !exporting,
                    onClick = { exportNameDialogOpen = false }
                ) {
                    Text("ANNULER")
                }
            }
        )
    }
}

@Composable
private fun StudioPrimaryTrack(
    hasAudio: Boolean,
    durationMs: Long,
    waveform: List<Float>,
    volume: Float,
    muted: Boolean,
    solo: Boolean,
    recording: Boolean,
    controlsEnabled: Boolean,
    timelineProgress: Float,
    timelineDurationMs: Long,
    playheadMs: Long,
    onTimelineSeek: (Float) -> Unit,
    onVolume: (Float) -> Unit,
    onMute: () -> Unit,
    onSolo: () -> Unit,
    onRecord: () -> Unit,
    onClear: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(2.dp, Color(0xFFFFDE59), RoundedCornerShape(16.dp))
            .background(Color(0xFF1A2329), RoundedCornerShape(16.dp))
            .padding(horizontal = 10.dp, vertical = 9.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "PISTE 1",
                color = if (recording) Color(0xFFFF6464) else Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = formatStudioDuration(if (recording) playheadMs else durationMs),
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(end = 8.dp)
            )
            StudioMiniButton(
                text = if (recording) "●" else "REC",
                active = recording,
                enabled = controlsEnabled || recording,
                activeColor = Color(0xFFB82020),
                onClick = onRecord
            )
            Spacer(Modifier.width(5.dp))
            StudioMiniButton(
                text = "M",
                active = muted,
                enabled = controlsEnabled,
                activeColor = Color(0xFFD38A19),
                onClick = onMute
            )
            Spacer(Modifier.width(5.dp))
            StudioMiniButton(
                text = "S",
                active = solo,
                enabled = controlsEnabled,
                activeColor = Color(0xFF2E7D5A),
                onClick = onSolo
            )
            Spacer(Modifier.width(5.dp))
            StudioMiniButton(
                text = "×",
                active = false,
                enabled = controlsEnabled && hasAudio,
                activeColor = Color(0xFF303A40),
                onClick = onClear
            )
        }

        Spacer(Modifier.height(7.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .background(Color(0xFF0D1418), RoundedCornerShape(9.dp))
                .pointerInput(timelineDurationMs, controlsEnabled) {
                    detectTapGestures { offset ->
                        if (controlsEnabled && size.width > 0) {
                            onTimelineSeek(offset.x / size.width.toFloat())
                        }
                    }
                }
                .padding(horizontal = 5.dp)
        ) {
            StudioTimelineWaveform(
                peaks = waveform,
                active = hasAudio,
                recording = recording,
                playheadProgress = timelineProgress,
                modifier = Modifier.fillMaxSize()
            )
            if (!hasAudio && !recording) {
                Text(
                    text = "Timeline commune",
                    color = Color(0xFF5F6C72),
                    fontSize = 10.sp,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(32.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "VOL",
                color = Color(0xFF8D9AA0),
                fontSize = 10.sp,
                modifier = Modifier.width(32.dp)
            )
            Slider(
                value = volume,
                onValueChange = onVolume,
                enabled = controlsEnabled && hasAudio,
                valueRange = 0f..1f,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = (volume * 100f).roundToInt().toString(),
                color = Color.White,
                fontSize = 10.sp,
                textAlign = TextAlign.End,
                modifier = Modifier.width(30.dp)
            )
        }
    }
}

@Composable
private fun CompactStudioTrack(
    index: Int,
    borderColor: Color,
    hasAudio: Boolean,
    durationMs: Long,
    timelineDurationMs: Long,
    volume: Float,
    muted: Boolean,
    solo: Boolean,
    recording: Boolean,
    controlsEnabled: Boolean,
    modifier: Modifier = Modifier,
    onVolume: (Float) -> Unit,
    onMute: () -> Unit,
    onSolo: () -> Unit,
    onRecord: () -> Unit,
    onClear: () -> Unit
) {
    Column(
        modifier = modifier
            .border(2.dp, borderColor, RoundedCornerShape(16.dp))
            .background(Color(0xFF1A2329), RoundedCornerShape(16.dp))
            .padding(horizontal = 7.dp, vertical = 7.dp)
    ) {
        Text(
            text = "PISTE " + (index + 1),
            color = if (recording) Color(0xFFFF6464) else Color.White,
            fontSize = 17.sp,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(5.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            StudioMiniButton(
                text = if (recording) "●" else "REC",
                active = recording,
                enabled = controlsEnabled || recording,
                activeColor = Color(0xFFB82020),
                onClick = onRecord
            )
            StudioMiniButton(
                text = "M",
                active = muted,
                enabled = controlsEnabled,
                activeColor = Color(0xFFD38A19),
                onClick = onMute
            )
            StudioMiniButton(
                text = "S",
                active = solo,
                enabled = controlsEnabled,
                activeColor = Color(0xFF2E7D5A),
                onClick = onSolo
            )
            StudioMiniButton(
                text = "×",
                active = false,
                enabled = controlsEnabled && hasAudio,
                activeColor = Color(0xFF303A40),
                onClick = onClear
            )
        }

        Spacer(Modifier.height(5.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(18.dp)
                .background(Color(0xFF0E1418), RoundedCornerShape(5.dp))
                .padding(2.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            if (hasAudio) {
                val clipFraction = (
                    durationMs.toFloat() / timelineDurationMs.coerceAtLeast(1L).toFloat()
                ).coerceIn(0.08f, 1f)
                Box(
                    modifier = Modifier
                        .fillMaxWidth(clipFraction)
                        .height(14.dp)
                        .background(
                            borderColor.copy(alpha = 0.72f),
                            RoundedCornerShape(4.dp)
                        )
                )
                Text(
                    text = formatStudioDuration(durationMs),
                    color = Color.White,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 5.dp)
                )
            } else {
                Text(
                    text = if (recording) "ENREGISTREMENT..." else "VIDE",
                    color = if (recording) Color(0xFFFF7777) else Color(0xFF536068),
                    fontSize = 8.sp,
                    modifier = Modifier.padding(start = 5.dp)
                )
            }
        }

        Spacer(Modifier.height(4.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(26.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "VOL",
                color = Color(0xFF8D9AA0),
                fontSize = 8.sp,
                modifier = Modifier.width(23.dp)
            )
            Slider(
                value = volume,
                onValueChange = onVolume,
                enabled = controlsEnabled && hasAudio,
                valueRange = 0f..1f,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = (volume * 100f).roundToInt().toString(),
                color = Color.White,
                fontSize = 8.sp,
                textAlign = TextAlign.End,
                modifier = Modifier.width(24.dp)
            )
        }
    }
}


/**
 * Visual-only metronome: its large light is also the TAP TEMPO surface.
 * Timing uses elapsedRealtime so wall-clock changes do not affect the beat.
 */
@Composable
private fun StudioLightMetronome(modifier: Modifier = Modifier) {
    var bpm by remember { mutableStateOf(120) }
    var running by remember { mutableStateOf(true) }
    var lightOn by remember { mutableStateOf(false) }
    var beatOrigin by remember { mutableStateOf(SystemClock.elapsedRealtime()) }
    val taps = remember { mutableListOf<Long>() }

    LaunchedEffect(bpm, running, beatOrigin) {
        if (!running) {
            lightOn = false
            return@LaunchedEffect
        }
        while (true) {
            lightOn = true
            delay(115L)
            lightOn = false
            delay((60_000L / bpm.toLong() - 115L).coerceAtLeast(35L))
        }
    }

    Row(
        modifier = modifier
            .border(2.dp, Color(0xFF79E6BD), RoundedCornerShape(16.dp))
            .background(Color(0xFF1A2329), RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "$bpm BPM",
            color = Color(0xFF79E6BD),
            fontSize = 19.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f)
        )

        Box(
            modifier = Modifier
                .size(46.dp)
                .background(
                    if (lightOn) Color(0xFF66FFB3) else Color(0xFF294239),
                    CircleShape
                )
                .border(2.dp, Color(0xFF79E6BD), CircleShape)
                .clickable {
                    val now = SystemClock.elapsedRealtime()
                    val interval = if (taps.isEmpty()) Long.MAX_VALUE else now - taps.last()
                    // A pause or an accidental double-tap starts a fresh measurement.
                    if (interval !in 190L..2000L) taps.clear()
                    taps.add(now)
                    if (taps.size > 5) taps.removeAt(0)
                    if (taps.size >= 2) {
                        val meanInterval = (taps.last() - taps.first()).toDouble() /
                            (taps.size - 1)
                        bpm = (60_000.0 / meanInterval).roundToInt().coerceIn(30, 300)
                    }
                    beatOrigin = now
                    running = true
                    lightOn = true
                },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "●",
                color = if (lightOn) Color.White else Color(0xFF79E6BD),
                fontSize = 22.sp
            )
        }

        Spacer(Modifier.width(9.dp))

        StudioTransportButton(
            text = if (running) "PAUSE" else "MARCHE",
            enabled = true,
            modifier = Modifier.width(66.dp)
        ) {
            running = !running
            taps.clear()
            if (running) beatOrigin = SystemClock.elapsedRealtime()
        }
    }
}

@Composable
private fun StudioTimelineWaveform(
    peaks: List<Float>,
    active: Boolean,
    recording: Boolean,
    playheadProgress: Float,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        val center = size.height / 2f
        if (peaks.isNotEmpty()) {
            val step = size.width / peaks.size.coerceAtLeast(1)
            val maxHalf = size.height * 0.38f
            val waveColor = when {
                recording -> Color(0xFFFF6666)
                active -> Color(0xFFFFDE59)
                else -> Color(0xFF49555B)
            }
            peaks.forEachIndexed { i, value ->
                val half = max(1f, value.coerceIn(0f, 1f) * maxHalf)
                val x = step * i + step / 2f
                drawLine(
                    color = waveColor,
                    start = Offset(x, center - half),
                    end = Offset(x, center + half),
                    strokeWidth = max(1f, step * 0.4f),
                    cap = StrokeCap.Round
                )
            }
        }

        val headX = size.width * playheadProgress.coerceIn(0f, 1f)
        drawLine(
            color = Color.White,
            start = Offset(headX, 0f),
            end = Offset(headX, size.height),
            strokeWidth = 2.5f,
            cap = StrokeCap.Round
        )
    }
}

@Composable
private fun StudioSquareButton(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .background(
                if (enabled) Color(0xFF303A40) else Color(0xFF1B2226),
                RoundedCornerShape(9.dp)
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = if (enabled) Color.White else Color(0xFF5C666B),
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun StudioMiniButton(
    text: String,
    active: Boolean,
    enabled: Boolean,
    activeColor: Color,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(width = 36.dp, height = 27.dp)
            .background(
                when {
                    !enabled -> Color(0xFF222A2E)
                    active -> activeColor
                    else -> Color(0xFF303A40)
                },
                RoundedCornerShape(7.dp)
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = if (enabled) Color.White else Color(0xFF5B6469),
            fontSize = if (text == "REC") 9.sp else 12.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun StudioTransportButton(
    text: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .height(38.dp)
            .background(
                if (enabled) Color(0xFF2A343A) else Color(0xFF1A2024),
                RoundedCornerShape(10.dp)
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = if (enabled) Color.White else Color(0xFF616C72),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

private fun formatStudioDuration(ms: Long): String {
    val seconds = (ms / 1000L).coerceAtLeast(0L)
    val min = seconds / 60L
    val sec = seconds % 60L
    return "%d:%02d".format(min, sec)
}

private class MerylStudioEngine(private val context: Context) {
    private val projectDir = File(context.filesDir, "meryl_studio/current_project").apply { mkdirs() }
    private val recording = AtomicBoolean(false)
    private val playbackStop = AtomicBoolean(false)
    private var currentRecorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private val playbackThreads = CopyOnWriteArrayList<Thread>()

    private fun trackFile(index: Int): File = File(projectDir, "track_" + (index + 1) + ".wav")
    private fun rawTempFile(index: Int): File = File(projectDir, "track_" + (index + 1) + ".raw.tmp")

    fun hasTrack(index: Int): Boolean = trackFile(index).let { it.isFile && it.length() > WAV_HEADER_SIZE }

    fun trackDurationMs(index: Int): Long {
        val file = trackFile(index)
        if (!file.isFile || file.length() <= WAV_HEADER_SIZE) return 0L
        val samples = (file.length() - WAV_HEADER_SIZE) / 2L
        return samples * 1000L / STUDIO_SAMPLE_RATE
    }

    fun trackPeaks(index: Int, buckets: Int): List<Float> {
        val file = trackFile(index)
        if (!file.isFile || file.length() <= WAV_HEADER_SIZE || buckets <= 0) return emptyList()
        val totalSamples = ((file.length() - WAV_HEADER_SIZE) / 2L).coerceAtLeast(1L)
        val samplesPerBucket = max(1L, totalSamples / buckets.toLong())
        val values = FloatArray(buckets)
        BufferedInputStream(FileInputStream(file)).use { input ->
            skipFully(input, WAV_HEADER_SIZE.toLong())
            val buffer = ByteArray(8192)
            var sampleIndex = 0L
            var read: Int
            while (input.read(buffer).also { read = it } > 0) {
                var i = 0
                while (i + 1 < read) {
                    val lo = buffer[i].toInt() and 0xFF
                    val hi = buffer[i + 1].toInt()
                    val sample = ((hi shl 8) or lo).toShort().toInt()
                    val bucket = (sampleIndex / samplesPerBucket).toInt().coerceAtMost(buckets - 1)
                    val normalized = abs(sample).toFloat() / 32768f
                    if (normalized > values[bucket]) values[bucket] = normalized
                    sampleIndex++
                    i += 2
                }
            }
        }
        return values.toList()
    }

    @SuppressLint("MissingPermission")
    fun startRecording(index: Int, settings: StudioMixSettings): Boolean {
        if (index !in 0 until STUDIO_TRACK_COUNT || recording.get()) return false
        stopPlayback()

        val minBuffer = AudioRecord.getMinBufferSize(
            STUDIO_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuffer <= 0) return false

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                STUDIO_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                max(minBuffer * 2, 16384)
            )
        } catch (_: Throwable) {
            return false
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { recorder.release() }
            return false
        }

        val temp = rawTempFile(index)
        runCatching { temp.delete() }

        startPlayback(settings, excludeTrack = index)

        currentRecorder = recorder
        recording.set(true)

        val thread = Thread {
            var ok = false
            try {
                BufferedOutputStream(FileOutputStream(temp)).use { output ->
                    recorder.startRecording()
                    val shorts = ShortArray(max(2048, minBuffer / 2))
                    val bytes = ByteArray(shorts.size * 2)
                    while (recording.get()) {
                        val count = recorder.read(shorts, 0, shorts.size)
                        if (count <= 0) continue
                        var b = 0
                        for (i in 0 until count) {
                            val sample = shorts[i].toInt()
                            bytes[b++] = (sample and 0xFF).toByte()
                            bytes[b++] = ((sample shr 8) and 0xFF).toByte()
                        }
                        output.write(bytes, 0, count * 2)
                    }
                    ok = temp.length() > 0L
                }
            } catch (_: Throwable) {
                ok = false
            } finally {
                runCatching {
                    if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
                }
                runCatching { recorder.release() }
                currentRecorder = null
                recording.set(false)
                stopPlayback()
                if (ok) {
                    val destination = trackFile(index)
                    runCatching {
                        writeWavFromRaw(temp, destination)
                    }
                }
                runCatching { temp.delete() }
            }
        }
        thread.name = "MerylStudioRecord-" + (index + 1)
        thread.start()
        recordThread = thread
        return true
    }

    fun stopRecordingBlocking(): Boolean {
        if (!recording.get()) return false
        recording.set(false)
        runCatching { currentRecorder?.stop() }
        runCatching { recordThread?.join(2500L) }
        recordThread = null
        stopPlayback()
        return true
    }

    fun startPlayback(
        settings: StudioMixSettings,
        excludeTrack: Int = -1,
        startOffsetMs: Long = 0L
    ): Long {
        stopPlayback()
        val selected = selectedTrackIndexes(settings, excludeTrack)
        if (selected.isEmpty()) return 0L

        val maxDuration = selected.maxOfOrNull { trackDurationMs(it) } ?: 0L
        val offset = startOffsetMs.coerceIn(0L, maxDuration)
        if (offset >= maxDuration) return 0L

        playbackStop.set(false)

        selected.forEach { index ->
            val file = trackFile(index)
            val volume = settings.volumes.getOrElse(index) { 1f }.coerceIn(0f, 1f)
            val thread = Thread {
                streamWavFile(file, volume, offset)
            }
            thread.name = "MerylStudioPlay-" + (index + 1)
            playbackThreads.add(thread)
            thread.start()
        }

        return (maxDuration - offset).coerceAtLeast(0L)
    }

    fun stopPlayback() {
        playbackStop.set(true)
        playbackThreads.forEach { thread ->
            runCatching { thread.interrupt() }
        }
        playbackThreads.clear()
    }

    fun stopAll() {
        if (recording.get()) {
            stopRecordingBlocking()
        } else {
            stopPlayback()
        }
    }

    fun deleteTrack(index: Int) {
        if (recording.get()) return
        runCatching { trackFile(index).delete() }
        runCatching { rawTempFile(index).delete() }
    }

    fun deleteAllTracks() {
        if (recording.get()) return
        stopPlayback()
        repeat(STUDIO_TRACK_COUNT) { index ->
            runCatching { trackFile(index).delete() }
            runCatching { rawTempFile(index).delete() }
        }
    }

    fun exportMix(settings: StudioMixSettings, requestedName: String): Uri? {
        val selected = selectedTrackIndexes(settings, excludeTrack = -1)
        if (selected.isEmpty()) return null

        val maxSamples = selected.maxOfOrNull { index ->
            ((trackFile(index).length() - WAV_HEADER_SIZE).coerceAtLeast(0L) / 2L)
        } ?: return null
        if (maxSamples <= 0L) return null

        val tempMix = File(projectDir, "mix_export.tmp.wav")
        val sources = selected.map { index ->
            val input = BufferedInputStream(FileInputStream(trackFile(index)))
            skipFully(input, WAV_HEADER_SIZE.toLong())
            MixSource(
                input = input,
                volume = settings.volumes.getOrElse(index) { 1f }.coerceIn(0f, 1f)
            )
        }

        try {
            BufferedOutputStream(FileOutputStream(tempMix)).use { output ->
                writeWavHeader(output, maxSamples * 2L)
                val blockSamples = 2048
                val sourceBuffers = sources.map { ShortArray(blockSamples) }
                val writeBuffer = ByteArray(blockSamples * 2)
                var processed = 0L

                while (processed < maxSamples) {
                    val count = minOf(blockSamples.toLong(), maxSamples - processed).toInt()
                    sources.forEachIndexed { i, source ->
                        readSamples(source.input, sourceBuffers[i], count)
                    }

                    var byteIndex = 0
                    for (sampleIndex in 0 until count) {
                        var mixed = 0f
                        sources.forEachIndexed { sourceIndex, source ->
                            mixed += sourceBuffers[sourceIndex][sampleIndex] * source.volume
                        }
                        val clipped = mixed.roundToInt().coerceIn(-32768, 32767)
                        writeBuffer[byteIndex++] = (clipped and 0xFF).toByte()
                        writeBuffer[byteIndex++] = ((clipped shr 8) and 0xFF).toByte()
                    }
                    output.write(writeBuffer, 0, count * 2)
                    processed += count
                }
            }
        } catch (_: Throwable) {
            runCatching { tempMix.delete() }
            return null
        } finally {
            sources.forEach { runCatching { it.input.close() } }
        }

        val cleanedBase = requestedName
            .trim()
            .removeSuffix(".wav")
            .removeSuffix(".WAV")
            .replace("/", "_")
            .replace("\\", "_")
            .replace(":", "_")
            .replace("*", "_")
            .replace("?", "_")
            .replace('"', '_')
            .replace("<", "_")
            .replace(">", "_")
            .replace("|", "_")
            .ifBlank {
                "MerylStudio_" +
                    SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE).format(Date())
            }
        val name = cleanedBase + ".wav"
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/wav")
            put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/MerylStudio")
            put(MediaStore.Audio.Media.IS_MUSIC, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }

        val resolver = context.contentResolver
        val uri = runCatching {
            resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
        }.getOrNull() ?: run {
            runCatching { tempMix.delete() }
            return null
        }

        val copied = runCatching {
            resolver.openOutputStream(uri)?.use { output ->
                FileInputStream(tempMix).use { input -> input.copyTo(output) }
            } ?: error("No output stream")
            true
        }.getOrDefault(false)

        runCatching { tempMix.delete() }

        if (!copied) {
            runCatching { resolver.delete(uri, null, null) }
            return null
        }

        runCatching {
            resolver.update(
                uri,
                ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) },
                null,
                null
            )
        }
        return uri
    }

    private fun selectedTrackIndexes(
        settings: StudioMixSettings,
        excludeTrack: Int
    ): List<Int> {
        val existing = (0 until STUDIO_TRACK_COUNT)
            .filter { it != excludeTrack && hasTrack(it) }
        if (existing.isEmpty()) return emptyList()

        val anySolo = existing.any { settings.solo.getOrElse(it) { false } }
        return existing.filter { index ->
            val soloOk = !anySolo || settings.solo.getOrElse(index) { false }
            val notMuted = !settings.muted.getOrElse(index) { false }
            soloOk && notMuted
        }
    }

    private fun streamWavFile(file: File, volume: Float, startOffsetMs: Long) {
        if (!file.isFile || file.length() <= WAV_HEADER_SIZE) return
        val minBuffer = AudioTrack.getMinBufferSize(
            STUDIO_SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(8192)

        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        val format = AudioFormat.Builder()
            .setSampleRate(STUDIO_SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        val player = try {
            AudioTrack(
                attributes,
                format,
                minBuffer,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            )
        } catch (_: Throwable) {
            return
        }

        try {
            player.setVolume(volume)
            player.play()
            BufferedInputStream(FileInputStream(file)).use { input ->
                val dataBytes = (file.length() - WAV_HEADER_SIZE).coerceAtLeast(0L)
                val requestedOffsetBytes =
                    (startOffsetMs.coerceAtLeast(0L) * STUDIO_SAMPLE_RATE.toLong() / 1000L) * 2L
                val offsetBytes = requestedOffsetBytes.coerceAtMost(dataBytes)
                skipFully(input, WAV_HEADER_SIZE.toLong() + offsetBytes)
                val buffer = ByteArray(minBuffer)
                while (!playbackStop.get() && !Thread.currentThread().isInterrupted) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    player.write(buffer, 0, read)
                }
            }
        } catch (_: Throwable) {
        } finally {
            runCatching { player.stop() }
            runCatching { player.release() }
        }
    }

    private fun writeWavFromRaw(raw: File, destination: File) {
        val dataLength = raw.length()
        val tempWav = File(destination.parentFile, destination.name + ".tmp")
        BufferedOutputStream(FileOutputStream(tempWav)).use { output ->
            writeWavHeader(output, dataLength)
            FileInputStream(raw).use { input -> input.copyTo(output) }
        }
        if (destination.exists()) destination.delete()
        if (!tempWav.renameTo(destination)) {
            tempWav.copyTo(destination, overwrite = true)
            tempWav.delete()
        }
    }

    private fun writeWavHeader(output: java.io.OutputStream, dataLength: Long) {
        val byteRate = STUDIO_SAMPLE_RATE * 2
        val totalDataLen = dataLength + 36L

        output.write("RIFF".toByteArray(Charsets.US_ASCII))
        writeLeInt(output, totalDataLen.toInt())
        output.write("WAVE".toByteArray(Charsets.US_ASCII))
        output.write("fmt ".toByteArray(Charsets.US_ASCII))
        writeLeInt(output, 16)
        writeLeShort(output, 1)
        writeLeShort(output, 1)
        writeLeInt(output, STUDIO_SAMPLE_RATE)
        writeLeInt(output, byteRate)
        writeLeShort(output, 2)
        writeLeShort(output, 16)
        output.write("data".toByteArray(Charsets.US_ASCII))
        writeLeInt(output, dataLength.toInt())
    }

    private fun writeLeInt(output: java.io.OutputStream, value: Int) {
        output.write(value and 0xFF)
        output.write((value shr 8) and 0xFF)
        output.write((value shr 16) and 0xFF)
        output.write((value shr 24) and 0xFF)
    }

    private fun writeLeShort(output: java.io.OutputStream, value: Int) {
        output.write(value and 0xFF)
        output.write((value shr 8) and 0xFF)
    }

    private fun readSamples(
        input: BufferedInputStream,
        destination: ShortArray,
        requested: Int
    ) {
        java.util.Arrays.fill(destination, 0.toShort())
        val bytesNeeded = requested * 2
        val bytes = ByteArray(bytesNeeded)
        var total = 0
        while (total < bytesNeeded) {
            val read = input.read(bytes, total, bytesNeeded - total)
            if (read <= 0) break
            total += read
        }
        var b = 0
        var sample = 0
        while (b + 1 < total && sample < requested) {
            val lo = bytes[b].toInt() and 0xFF
            val hi = bytes[b + 1].toInt()
            destination[sample] = ((hi shl 8) or lo).toShort()
            b += 2
            sample++
        }
    }

    private fun skipFully(input: BufferedInputStream, bytes: Long) {
        var remaining = bytes
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
            } else if (input.read() >= 0) {
                remaining--
            } else {
                break
            }
        }
    }

    private data class MixSource(
        val input: BufferedInputStream,
        val volume: Float
    )
}
