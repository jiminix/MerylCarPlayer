package com.nik.roadplayer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
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
import kotlin.math.roundToLong
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

private const val STUDIO_TRACK_COUNT = 3
private const val STUDIO_SAMPLE_RATE = 44100
private const val WAV_HEADER_SIZE = 44

private data class StudioMixSettings(
    val volumes: List<Float>,
    val muted: List<Boolean>,
    val solo: List<Boolean>,
    val looped: List<Boolean>,
    val bpm: Int
)

@Composable
fun StudioScreen(
    onBack: () -> Unit,
    scanEnabled: Boolean,
    scanning: Boolean,
    scanColor: Color,
    onScan: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember { MerylStudioEngine(context.applicationContext) }

    val volumes = remember { mutableStateListOf(1f, 1f, 1f) }
    val muted = remember { mutableStateListOf(false, false, false) }
    val solo = remember { mutableStateListOf(false, false, false) }
    val looped = remember { mutableStateListOf(false, false, false) }
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
    var tempoBpm by remember { mutableStateOf(120) }
    var beatOrigin by remember { mutableStateOf(SystemClock.elapsedRealtime()) }
    var countdownTrack by remember { mutableStateOf<Int?>(null) }
    var countdownBeat by remember { mutableStateOf(0) }
    var countdownTempo by remember { mutableStateOf(120) }
    var stoppingRecording by remember { mutableStateOf(false) }
    var projectDialogOpen by remember { mutableStateOf(false) }
    var projectName by remember { mutableStateOf("") }
    var projectList by remember { mutableStateOf<List<String>>(emptyList()) }
    var projectToDelete by remember { mutableStateOf<String?>(null) }
    var currentProjectName by remember { mutableStateOf(engine.currentProjectName()) }
    var cleaningSilences by remember { mutableStateOf(false) }
    var projectBusy by remember { mutableStateOf(false) }
    val segmentEnds = remember { mutableStateListOf<Long>() }

    val projectNameVoiceLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val spoken = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
            if (!spoken.isNullOrBlank()) projectName = spoken
        }
    }

    val storedTimelineDuration = durations.maxOrNull()?.coerceAtLeast(0L) ?: 0L
    val liveRecordingDuration = if (recordingTrack != null && recordingStartedAt > 0L) {
        (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
    } else {
        0L
    }
    val timelineDuration = max(1000L, max(storedTimelineDuration, liveRecordingDuration))
    val timelineProgress = (playheadMs.toFloat() / timelineDuration.toFloat()).coerceIn(0f, 1f)

    fun freshProjectName(): String = SimpleDateFormat("dd-MM-yy_HHmmss", Locale.FRANCE).format(Date()) + "_Projet"

    fun settings(): StudioMixSettings = StudioMixSettings(
        volumes = volumes.toList(),
        muted = muted.toList(),
        solo = solo.toList(),
        looped = looped.toList(),
        bpm = tempoBpm
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
        if (recordingTrack != null || stoppingRecording || exporting) return
        playing = false
        engine.stopPlayback()
        // A new take becomes the next common timeline segment.
        playheadMs = storedTimelineDuration
        playbackStartOffset = storedTimelineDuration
        recordingStartedAt = SystemClock.elapsedRealtime()
        beatOrigin = recordingStartedAt
        val started = engine.startRecording(
            index = index,
            settings = settings(),
            inputGain = if (index == 0) 4f else 1f
        )
        if (!started) {
            recordingStartedAt = 0L
            Toast.makeText(context, "Impossible de démarrer le micro", Toast.LENGTH_LONG).show()
            return
        }
        recordingTrack = index
    }

    fun beginCountdown(index: Int) {
        if (recordingTrack != null || countdownTrack != null || stoppingRecording || exporting) return
        engine.stopPlayback()
        playing = false
        countdownTempo = tempoBpm
        beatOrigin = SystemClock.elapsedRealtime()
        countdownBeat = 3
        countdownTrack = index
    }

    fun requestRecord(index: Int) {
        if (recordingTrack != null || countdownTrack != null || stoppingRecording || exporting) return
        if (ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            beginCountdown(index)
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
            beginCountdown(track)
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
        segmentEnds.clear()
        segmentEnds.addAll(engine.readPrimaryTakeEnds())
    }

    // Three silent beats at tap tempo; capture starts immediately after the last beat.
    LaunchedEffect(countdownTrack, countdownTempo) {
        val target = countdownTrack ?: return@LaunchedEffect
        val period = 60_000.0 / countdownTempo.coerceIn(30, 300).toDouble()
        val origin = beatOrigin
        for (beat in 3 downTo 1) {
            countdownBeat = beat
            val nextBoundary = origin + ((4 - beat) * period).roundToLong()
            delay((nextBoundary - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
        }
        if (countdownTrack == target) {
            countdownTrack = null
            countdownBeat = 0
            beginRecording(target)
        }
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
            playheadMs = playbackStartOffset + (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF10171B))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 7.dp, vertical = 6.dp)
                .padding(bottom = 64.dp)
        ) {

        Text(
            text = if (currentProjectName.isBlank()) "FICHIER : —" else "FICHIER : $currentProjectName",
            color = Color(0xFF79E6BD),
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 3.dp, vertical = 2.dp)
        )

        Spacer(Modifier.height(5.dp))

        StudioPrimaryTrack(
            hasAudio = existing[0],
            durationMs = durations[0],
            waveform = peaks[0],
            volume = volumes[0],
            muted = muted[0],
            solo = solo[0],
            recording = recordingTrack == 0,
            countdownBeat = if (countdownTrack == 0) countdownBeat else 0,
            controlsEnabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting,
            timelineProgress = timelineProgress,
            timelineDurationMs = timelineDuration,
            playheadMs = playheadMs,
            segmentBoundariesMs = segmentEnds.toList(),
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
                engine.writePrimaryTakeEnds(emptyList())
                segmentEnds.clear()
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
                text = "⏮",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting,
                modifier = Modifier.width(48.dp)
            ) {
                engine.stopPlayback()
                playing = false
                val takeStarts = listOf(0L) + segmentEnds.filter { it > 0L && it < storedTimelineDuration }.sorted()
                val previous = takeStarts.filter { it < playheadMs - 50L }.maxOrNull() ?: 0L
                playbackStartOffset = previous
                playbackStartedAt = 0L
                playheadMs = previous
            }

            Spacer(Modifier.width(4.dp))

            StudioTransportButton(
                text = "⏭",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting && existing.any { it },
                modifier = Modifier.width(48.dp)
            ) {
                engine.stopPlayback()
                playing = false
                val takeStarts = listOf(0L) + segmentEnds.filter { it > 0L && it < storedTimelineDuration }.sorted()
                val next = takeStarts.filter { it > playheadMs + 50L }.minOrNull() ?: storedTimelineDuration
                playbackStartOffset = next
                playbackStartedAt = 0L
                playheadMs = next
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = if (playing) "■" else "▶",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && existing.any { it } && !exporting,
                activeColor = Color(0xFF208457),
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
                        beatOrigin = playbackStartedAt
                        playheadMs = startAt
                        playing = true
                    }
                }
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = "■",
                enabled = countdownTrack != null || (recordingTrack != null && !stoppingRecording) || playing,
                activeColor = Color(0xFFB33E44),
                modifier = Modifier.width(48.dp)
            ) {
                if (countdownTrack != null) {
                    countdownTrack = null
                    countdownBeat = 0
                } else if (recordingTrack != null && !stoppingRecording) {
                    stoppingRecording = true
                    val stoppedTrack = recordingTrack
                    val recordedEndMs = if (recordingStartedAt > 0L) {
                        (SystemClock.elapsedRealtime() - recordingStartedAt).coerceAtLeast(0L)
                    } else {
                        playheadMs
                    }
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            engine.stopRecordingBlocking()
                        }
                        recordingTrack = null
                        recordingStartedAt = 0L
                        stoppingRecording = false
                        stoppedTrack?.let { track ->
                            val actualDuration = withContext(Dispatchers.IO) {
                                engine.trackDurationMs(track)
                            }
                            existing[track] = engine.hasTrack(track)
                            durations[track] = actualDuration
                            if (track == 0) {
                                peaks[track] = withContext(Dispatchers.IO) {
                                    engine.trackPeaks(track, 96)
                                }
                            }
                            // By default, keep the playhead exactly at the end of the
                            // recording that has just been committed to disk.
                            playheadMs = actualDuration.takeIf { it > 0L } ?: recordedEndMs
                            if (track == 0 && playheadMs > 0L && segmentEnds.none { kotlin.math.abs(it - playheadMs) < 50L }) {
                                segmentEnds.add(playheadMs)
                                segmentEnds.sort()
                                engine.writePrimaryTakeEnds(segmentEnds.toList())
                            }
                            playbackStartOffset = playheadMs
                            playbackStartedAt = 0L


                        }
                    }
                } else {
                    engine.stopPlayback()
                    playing = false
                }
            }

            Spacer(Modifier.width(6.dp))

            StudioTransportButton(
                text = "✂",
                enabled = recordingTrack == null &&
                    countdownTrack == null &&
                    !stoppingRecording &&
                    !exporting &&
                    !cleaningSilences &&
                    existing[0],
                activeColor = Color(0xFF5D466F),
                modifier = Modifier.width(48.dp)
            ) {
                engine.stopPlayback()
                playing = false
                cleaningSilences = true
                val autoSaveName = currentProjectName
                val autoSaveSettings = settings()
                scope.launch {
                    val removedMs = withContext(Dispatchers.IO) {
                        engine.removeLongSilences(0)
                    }
                    val trackInfo = withContext(Dispatchers.IO) {
                        Triple(
                            engine.hasTrack(0),
                            engine.trackDurationMs(0),
                            engine.trackPeaks(0, 96)
                        )
                    }
                    existing[0] = trackInfo.first
                    durations[0] = trackInfo.second
                    peaks[0] = trackInfo.third
                    playheadMs = trackInfo.second
                    playbackStartOffset = playheadMs
                    playbackStartedAt = 0L
                    segmentEnds.clear()


                    cleaningSilences = false
                    Toast.makeText(
                        context,
                        when {
                            removedMs < 0L -> "Nettoyage impossible"
                            removedMs == 0L -> "Aucun silence long détecté"
                            else -> "Silences supprimés : ${formatStudioDuration(removedMs)}"
                        },
                        Toast.LENGTH_LONG
                    ).show()
                }
            }

        }

        Spacer(Modifier.height(7.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center
        ) {
            StudioTransportButton(
                text = "SAVE",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && existing.any { it } && !exporting,
                activeColor = Color(0xFF355D48),
                modifier = Modifier.weight(1f)
            ) {
                if (currentProjectName.isNotBlank()) {
                    val nameToUpdate = currentProjectName
                    val currentSettings = settings()
                    scope.launch {
                        val saved = withContext(Dispatchers.IO) {
                            engine.saveProject(nameToUpdate, currentSettings)
                        }
                        if (saved) {
                            currentProjectName = engine.currentProjectName()
                            Toast.makeText(
                                context,
                                "Projet mis à jour : $currentProjectName",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            Toast.makeText(context, "Sauvegarde impossible", Toast.LENGTH_SHORT).show()
                        }
                    }
                } else {
                    projectName = freshProjectName()
                    projectList = engine.listProjects()
                    projectDialogOpen = true
                }
            }
            Spacer(Modifier.width(3.dp))
            StudioTransportButton(
                text = "↶ 1",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting && existing[0],
                activeColor = Color(0xFFAD6822),
                modifier = Modifier.weight(1f)
            ) {
                engine.stopPlayback()
                playing = false
                scope.launch {
                    val previousEnds = segmentEnds.toList()
                    val ok = withContext(Dispatchers.IO) {
                        engine.undoLastPrimaryTake(previousEnds)
                    }
                    if (ok) {
                        segmentEnds.clear()
                        segmentEnds.addAll(engine.readPrimaryTakeEnds())
                        refreshTrack(0)
                        val remaining = engine.trackDurationMs(0)
                        playheadMs = remaining
                        playbackStartOffset = remaining
                        playbackStartedAt = 0L
                        if (currentProjectName.isNotBlank()) {
                            val saved = withContext(Dispatchers.IO) {
                                engine.saveProject(currentProjectName, settings())
                            }
                            if (!saved) Toast.makeText(context, "Projet modifié : sauvegarde à refaire", Toast.LENGTH_LONG).show()
                        }
                        Toast.makeText(context, "Dernière prise de la piste 1 annulée", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(context, "Impossible d'annuler la prise", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            Spacer(Modifier.width(3.dp))
            StudioTransportButton(
                text = "UNDO",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting && !projectBusy && existing.any { it },
                activeColor = Color(0xFF8E3439),
                modifier = Modifier.weight(1f)
            ) {
                engine.stopPlayback()
                playing = false
                projectBusy = true
                val snapshotSettings = settings()
                val snapshotName = freshProjectName()
                scope.launch {
                    // Never overwrite an existing project here: only SAVE updates it.
                    val saved = withContext(Dispatchers.IO) {
                        engine.saveProject(snapshotName, snapshotSettings)
                    }
                    if (saved) {
                        Toast.makeText(context, "Enregistrement sauvegardé : $snapshotName", Toast.LENGTH_LONG).show()
                        engine.deleteAllTracks()
                        engine.writePrimaryTakeEnds(emptyList())
                        segmentEnds.clear()
                        repeat(STUDIO_TRACK_COUNT) { index ->
                            existing[index] = false
                            durations[index] = 0L
                            peaks[index] = emptyList()
                        }
                        playheadMs = 0L
                        playbackStartOffset = 0L
                        playbackStartedAt = 0L
                        currentProjectName = freshProjectName()
                        engine.setCurrentProjectName(currentProjectName)
                        Toast.makeText(context, "Nouveau projet : $currentProjectName", Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(context, "Sauvegarde impossible : projet conservé", Toast.LENGTH_LONG).show()
                    }
                    projectBusy = false
                }
            }
            Spacer(Modifier.width(3.dp))
            StudioTransportButton(
                text = "OPEN",
                enabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting,
                activeColor = Color(0xFF3D527A),
                modifier = Modifier.weight(1f)
            ) {
                projectList = engine.listProjects()
                if (projectList.isEmpty()) {
                    Toast.makeText(context, "Aucun projet enregistré", Toast.LENGTH_SHORT).show()
                } else {
                    projectName = ""
                    projectDialogOpen = true
                }
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
                countdownBeat = if (countdownTrack == 1) countdownBeat else 0,
                looped = looped[1],
                controlsEnabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting,
                modifier = Modifier.weight(1f),
                onVolume = { volumes[1] = it },
                onMute = { muted[1] = !muted[1] },
                onSolo = { solo[1] = !solo[1] },
                onRecord = { requestRecord(1) },
                onLoop = { looped[1] = !looped[1] },
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
                countdownBeat = if (countdownTrack == 2) countdownBeat else 0,
                looped = looped[2],
                controlsEnabled = recordingTrack == null && countdownTrack == null && !stoppingRecording && !exporting,
                modifier = Modifier.weight(1f),
                onVolume = { volumes[2] = it },
                onMute = { muted[2] = !muted[2] },
                onSolo = { solo[2] = !solo[2] },
                onRecord = { requestRecord(2) },
                onLoop = { looped[2] = !looped[2] },
                onClear = {
                    engine.deleteTrack(2)
                    existing[2] = false
                    durations[2] = 0L
                }
            )
        }

        Spacer(Modifier.height(7.dp))

        StudioLightMetronome(
            modifier = Modifier.fillMaxWidth(),
            bpm = tempoBpm,
            beatOrigin = beatOrigin,
            tempoLocked = countdownTrack != null || recordingTrack != null ||
                stoppingRecording || playing || exporting,
            onBpmChange = { tempoBpm = it },
            onBeatOriginChange = { beatOrigin = it }
        )

            Spacer(Modifier.height(10.dp))
        }

        if (countdownTrack != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xE610171B)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = countdownBeat.toString(),
                        color = Color.White,
                        fontSize = 128.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        text = "PISTE ${countdownTrack!! + 1}",
                        color = Color.White,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }


    }

    projectToDelete?.let { name ->
        AlertDialog(
            onDismissRequest = { projectToDelete = null },
            title = { Text("Supprimer le projet ?") },
            text = { Text("Supprimer définitivement « ${studioDisplayProjectName(name)} » ? Cette action est irréversible.") },
            confirmButton = {
                TextButton(onClick = {
                    if (engine.deleteSavedProject(name)) {
                        projectList = engine.listProjects()
                        Toast.makeText(context, "Projet supprimé", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(context, "Suppression impossible", Toast.LENGTH_SHORT).show()
                    }
                    projectToDelete = null
                }) { Text("SUPPRIMER", color = Color(0xFFFF7777)) }
            },
            dismissButton = { TextButton(onClick = { projectToDelete = null }) { Text("ANNULER") } }
        )
    }

    if (projectDialogOpen) {
        AlertDialog(
            onDismissRequest = { projectDialogOpen = false },
            title = { Text(if (projectName.isNotEmpty()) "Sauvegarder le projet" else "Ouvrir un projet", fontWeight = FontWeight.Bold) },
            text = {
                if (projectName.isNotEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = projectName,
                            onValueChange = { projectName = it },
                            singleLine = true,
                            label = { Text("Nom du projet") },
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(Modifier.width(6.dp))
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .background(Color(0xFF3D527A), RoundedCornerShape(10.dp))
                                .clickable {
                                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                                        putExtra(RecognizerIntent.EXTRA_PROMPT, "Dicte le nom du projet")
                                    }
                                    runCatching { projectNameVoiceLauncher.launch(intent) }
                                        .onFailure {
                                            Toast.makeText(context, "Reconnaissance vocale indisponible", Toast.LENGTH_SHORT).show()
                                        }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Text("🎤", fontSize = 22.sp)
                        }
                    }
                } else {
                    Column {
                        projectList.forEach { name ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp)
                                    .background(Color(0xFFFFF4CC), RoundedCornerShape(10.dp))
                                    .padding(horizontal = 10.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                            Text(
                                text = studioDisplayProjectName(name),
                                color = Color(0xFF17243A),
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable {
                                        engine.stopPlayback()
                                        playing = false
                                        if (engine.loadProject(name)) {
                                            currentProjectName = engine.currentProjectName()
                                            segmentEnds.clear()
                                            segmentEnds.addAll(engine.readPrimaryTakeEnds())
                                            repeat(STUDIO_TRACK_COUNT) { refreshTrack(it) }
                                            val loaded = engine.loadProjectSettings()
                                            loaded?.let { s ->
                                                repeat(STUDIO_TRACK_COUNT) { i ->
                                                    volumes[i] = s.volumes.getOrElse(i) { 1f }
                                                    muted[i] = s.muted.getOrElse(i) { false }
                                                    solo[i] = s.solo.getOrElse(i) { false }
                                                    looped[i] = s.looped.getOrElse(i) { false }
                                                }
                                                tempoBpm = s.bpm
                                            }
                                            playheadMs = (0 until STUDIO_TRACK_COUNT).maxOfOrNull { engine.trackDurationMs(it) } ?: 0L
                                            Toast.makeText(context, "Projet ouvert : $name", Toast.LENGTH_SHORT).show()
                                        }
                                        projectDialogOpen = false
                                    }
                                    .padding(vertical = 10.dp)
                            )
                            TextButton(onClick = { projectToDelete = name }) {
                                Text("×", color = Color(0xFFB00020), fontWeight = FontWeight.Bold, fontSize = 28.sp)
                            }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                if (projectName.isNotEmpty()) {
                    TextButton(onClick = {
                        val name = projectName.trim()
                        if (name.isNotEmpty() && engine.saveProject(name, settings())) {
                            currentProjectName = engine.currentProjectName()
                            Toast.makeText(
                                context,
                                "Projet enregistré : $currentProjectName",
                                Toast.LENGTH_SHORT
                            ).show()
                            projectDialogOpen = false
                        }
                    }) { Text("ENREGISTRER") }
                }
            },
            dismissButton = {
                TextButton(onClick = { projectDialogOpen = false }) { Text("ANNULER") }
            }
        )
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
                    suffix = { Text(".mp3") }
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
    countdownBeat: Int,
    controlsEnabled: Boolean,
    timelineProgress: Float,
    timelineDurationMs: Long,
    playheadMs: Long,
    segmentBoundariesMs: List<Long>,
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
            .background(Color(0xFF5F4A1B), RoundedCornerShape(16.dp))
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
                text = if (countdownBeat > 0) countdownBeat.toString() else if (recording) "●" else "REC",
                active = recording || countdownBeat > 0,
                enabled = controlsEnabled || recording || countdownBeat > 0,
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
                segmentBoundariesMs = segmentBoundariesMs,
                timelineDurationMs = timelineDurationMs,
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
    countdownBeat: Int,
    looped: Boolean,
    controlsEnabled: Boolean,
    modifier: Modifier = Modifier,
    onVolume: (Float) -> Unit,
    onMute: () -> Unit,
    onSolo: () -> Unit,
    onRecord: () -> Unit,
    onLoop: () -> Unit,
    onClear: () -> Unit
) {
    Column(
        modifier = modifier
            .border(2.dp, borderColor, RoundedCornerShape(16.dp))
            .background(
                if (index == 1) Color(0xFF61361F) else Color(0xFF2A3F79),
                RoundedCornerShape(16.dp)
            )
            .padding(horizontal = 7.dp, vertical = 7.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "PISTE " + (index + 1),
                color = if (recording) Color(0xFFFF6464) else Color.White,
                fontSize = 17.sp,
                fontWeight = FontWeight.ExtraBold,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f)
            )
            StudioMiniButton(
                text = "↻",
                active = looped,
                enabled = controlsEnabled && hasAudio,
                activeColor = Color(0xFF237E66),
                onClick = onLoop
            )
        }

        Spacer(Modifier.height(5.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            StudioMiniButton(
                text = if (countdownBeat > 0) countdownBeat.toString() else if (recording) "●" else "REC",
                active = recording || countdownBeat > 0,
                enabled = controlsEnabled || recording || countdownBeat > 0,
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
private fun StudioLightMetronome(
    modifier: Modifier = Modifier,
    bpm: Int,
    beatOrigin: Long,
    tempoLocked: Boolean,
    onBpmChange: (Int) -> Unit,
    onBeatOriginChange: (Long) -> Unit
) {
    var running by remember { mutableStateOf(true) }
    var lightOn by remember { mutableStateOf(false) }
    val taps = remember { mutableListOf<Long>() }

    LaunchedEffect(bpm, running, beatOrigin) {
        if (!running) {
            lightOn = false
            return@LaunchedEffect
        }
        while (true) {
            val periodMs = 60_000.0 / bpm.coerceIn(30, 300).toDouble()
            val elapsed = (SystemClock.elapsedRealtime() - beatOrigin).coerceAtLeast(0L)
            val phase = elapsed.toDouble() % periodMs
            val flashMs = minOf(115.0, periodMs * 0.4)
            lightOn = phase < flashMs
            val toNext = if (lightOn) flashMs - phase else periodMs - phase
            delay(toNext.roundToLong().coerceAtLeast(1L))
        }
    }

    Row(
        modifier = modifier
            .border(2.dp, Color(0xFF79E6BD), RoundedCornerShape(16.dp))
            .background(Color(0xFF215444), RoundedCornerShape(16.dp))
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
                .clickable(enabled = !tempoLocked) {
                    val now = SystemClock.elapsedRealtime()
                    val interval = if (taps.isEmpty()) Long.MAX_VALUE else now - taps.last()
                    // A pause or an accidental double-tap starts a fresh measurement.
                    if (interval !in 190L..2000L) taps.clear()
                    taps.add(now)
                    if (taps.size > 5) taps.removeAt(0)
                    if (taps.size >= 2) {
                        val meanInterval = (taps.last() - taps.first()).toDouble() /
                            (taps.size - 1)
                        onBpmChange((60_000.0 / meanInterval).roundToInt().coerceIn(30, 300))
                    }
                    onBeatOriginChange(now)
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
            if (running) onBeatOriginChange(SystemClock.elapsedRealtime())
        }
    }
}

@Composable
private fun StudioTimelineWaveform(
    peaks: List<Float>,
    active: Boolean,
    recording: Boolean,
    playheadProgress: Float,
    segmentBoundariesMs: List<Long>,
    timelineDurationMs: Long,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        val center = size.height / 2f
        if (peaks.isNotEmpty()) {
            val step = size.width / peaks.size.coerceAtLeast(1)
            val maxHalf = size.height * 0.38f
            val takeColors = listOf(
                Color(0xFFFFDE59), Color(0xFF5E7CFF), Color(0xFFFF7A20),
                Color(0xFF79E6BD), Color(0xFFE96BC7), Color(0xFF9D7CFF)
            )
            val takeStarts = buildList {
                add(0L)
                segmentBoundariesMs.filter { it > 0L && it < timelineDurationMs }.sorted().forEach { add(it) }
            }
            peaks.forEachIndexed { i, value ->
                val half = max(1f, value.coerceIn(0f, 1f) * maxHalf)
                val x = step * i + step / 2f
                val sampleMs = ((i.toDouble() / peaks.size.coerceAtLeast(1)) * timelineDurationMs).toLong()
                val takeIndex = takeStarts.indexOfLast { it <= sampleMs }.coerceAtLeast(0)
                val waveColor = when {
                    recording && takeIndex == takeStarts.lastIndex -> Color(0xFFFF6666)
                    active -> takeColors[takeIndex % takeColors.size]
                    else -> Color(0xFF49555B)
                }
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
    activeColor: Color = Color(0xFF2A343A),
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .height(38.dp)
            .background(
                if (enabled) activeColor else Color(0xFF1A2024),
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

private fun studioDisplayProjectName(name: String): String {
    // Only change the visible label; keep the original folder name for loading/deleting.
    val yearFirst = Regex("""(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}""").find(name)
    if (yearFirst != null) {
        val digits = yearFirst.value.filter { it.isDigit() }
        val year = digits.substring(0, 4)
        val month = digits.substring(4, 6)
        val day = digits.substring(6, 8)
        if (month.toIntOrNull() in 1..12 && day.toIntOrNull() in 1..31) {
            val rest = (name.substring(0, yearFirst.range.first) +
                name.substring(yearFirst.range.last + 1))
                .trim('_', '-', ' ')
                .ifBlank { "Projet" }
            return "$day/$month/$year · $rest"
        }
    }
    val dayFirst = Regex("""^(\d{2})[-_/](\d{2})[-_/](\d{2}|\d{4})(.*)$""").matchEntire(name)
    if (dayFirst != null) {
        val (day, month, shortYear, suffix) = dayFirst.destructured
        val year = if (shortYear.length == 2) "20$shortYear" else shortYear
        return "$day/$month/$year · ${suffix.trim('_', '-', ' ').ifBlank { "Projet" }}"
    }
    return name
}

private fun formatStudioDuration(ms: Long): String {
    val seconds = (ms / 1000L).coerceAtLeast(0L)
    val min = seconds / 60L
    val sec = seconds % 60L
    return "%d:%02d".format(min, sec)
}

private class MerylStudioEngine(private val context: Context) {
    private val projectDir = File(context.filesDir, "meryl_studio/current_project").apply { mkdirs() }
    private val savedProjectsDir = File(context.filesDir, "meryl_studio/saved_projects").apply { mkdirs() }
    private val studioPrefs = context.getSharedPreferences("meryl_studio", Context.MODE_PRIVATE)
    private val recording = AtomicBoolean(false)
    private val playbackGeneration = AtomicInteger(0)
    private var currentRecorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private val playbackThreads = CopyOnWriteArrayList<Thread>()

    private fun trackFile(index: Int): File = File(projectDir, "track_" + (index + 1) + ".wav")
    private fun rawTempFile(index: Int): File = File(projectDir, "track_" + (index + 1) + ".raw.tmp")

    fun currentProjectName(): String =
        studioPrefs.getString("current_project_name", "").orEmpty()

    fun setCurrentProjectName(name: String) = rememberCurrentProject(name)

    private fun rememberCurrentProject(name: String) {
        studioPrefs.edit().putString("current_project_name", name).apply()
    }

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
    fun startRecording(
        index: Int,
        settings: StudioMixSettings,
        inputGain: Float = 1f
    ): Boolean {
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

        // Keep REC on the phone's built-in microphone even when USB-C audio is connected.
        // Playback/output routing remains managed by Android and can continue through the car stereo.
        runCatching {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val builtInMic = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
            if (builtInMic != null) recorder.setPreferredDevice(builtInMic)
        }

        val temp = rawTempFile(index)
        runCatching { temp.delete() }
        val safeInputGain = inputGain.coerceIn(1f, 4f)

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
                            val rawSample = shorts[i].toInt()
                            val sample = if (safeInputGain > 1f) {
                                (rawSample * safeInputGain).roundToInt().coerceIn(-32768, 32767)
                            } else rawSample
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
                        appendRawToWav(temp, destination)
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

        val maxDuration = selected.maxOfOrNull { index ->
            val totalFrames = StudioPcmSource.cycleSamples(
                trackFile(index),
                looped = index > 0 && settings.looped.getOrElse(index) { false },
                bpm = settings.bpm
            )
            totalFrames * 1000L / STUDIO_SAMPLE_RATE
        } ?: 0L
        val offset = startOffsetMs.coerceIn(0L, maxDuration)
        if (offset >= maxDuration) return 0L

        val generation = playbackGeneration.get()

        selected.forEach { index ->
            val file = trackFile(index)
            val volume = settings.volumes.getOrElse(index) { 1f }.coerceIn(0f, 1f)
            val thread = Thread {
                streamWavFile(
                    file,
                    volume,
                    offset,
                    looped = index > 0 && settings.looped.getOrElse(index) { false },
                    bpm = settings.bpm,
                    generation = generation
                )
            }
            thread.name = "MerylStudioPlay-" + (index + 1)
            playbackThreads.add(thread)
            thread.start()
        }

        return (maxDuration - offset).coerceAtLeast(0L)
    }

    fun stopPlayback() {
        playbackGeneration.incrementAndGet()
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

    private val primaryTakesFile get() = File(projectDir, "primary_takes.json")

    fun readPrimaryTakeEnds(): List<Long> = runCatching {
        val json = org.json.JSONArray(primaryTakesFile.readText())
        (0 until json.length()).map { json.getLong(it) }.filter { it > 0L }.distinct().sorted()
    }.getOrDefault(emptyList())

    fun writePrimaryTakeEnds(ends: List<Long>) {
        runCatching {
            primaryTakesFile.writeText(org.json.JSONArray(ends.filter { it > 0L }.distinct().sorted()).toString())
        }
    }

    fun undoLastPrimaryTake(ends: List<Long>): Boolean {
        if (recording.get()) return false
        val wav = trackFile(0)
        if (!wav.isFile || wav.length() <= WAV_HEADER_SIZE) return false
        val currentDuration = trackDurationMs(0)
        val validEnds = ends.filter { it > 0L && it <= currentDuration + 100L }.distinct().sorted()
        val previous = validEnds.dropLast(1).lastOrNull() ?: 0L
        if (previous >= currentDuration) return false
        return runCatching {
            if (previous <= 0L) {
                wav.delete()
            } else {
                val bytesPerSecond = STUDIO_SAMPLE_RATE * 2L
                val dataBytes = (previous * bytesPerSecond / 1000L).coerceAtMost(wav.length() - WAV_HEADER_SIZE)
                val tmp = File(projectDir, "primary_undo.tmp.wav")
                BufferedOutputStream(FileOutputStream(tmp)).use { output ->
                    writeWavHeader(output, dataBytes)
                    BufferedInputStream(FileInputStream(wav)).use { input ->
                        skipFully(input, WAV_HEADER_SIZE.toLong())
                        val buffer = ByteArray(8192)
                        var remaining = dataBytes
                        while (remaining > 0L) {
                            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                            if (count <= 0) break
                            output.write(buffer, 0, count)
                            remaining -= count
                        }
                        check(remaining == 0L)
                    }
                }
                tmp.copyTo(wav, overwrite = true)
                tmp.delete()
            }
            writePrimaryTakeEnds(validEnds.dropLast(1))
            true
        }.getOrDefault(false)
    }

    fun deleteSavedProject(name: String): Boolean {
        if (recording.get()) return false
        val project = File(savedProjectsDir, name)
        if (!project.isDirectory || project.parentFile?.canonicalFile != savedProjectsDir.canonicalFile) return false
        return runCatching { project.deleteRecursively() }.getOrDefault(false)
    }

    fun listProjects(): List<String> =
        savedProjectsDir.listFiles()
            ?.filter { it.isDirectory }
            ?.map { it.name }
            ?.sortedDescending()
            ?: emptyList()

    fun saveProject(requestedName: String, settings: StudioMixSettings): Boolean {
        if (recording.get()) return false
        val safeName = requestedName.trim()
            .replace(Regex("[\\\\/:*?\"<>|]"), "_")
            .ifBlank { "Projet" }
        val destination = File(savedProjectsDir, safeName)
        val saved = runCatching {
            if (destination.exists()) destination.deleteRecursively()
            destination.mkdirs()
            repeat(STUDIO_TRACK_COUNT) { index ->
                val source = trackFile(index)
                if (source.isFile) source.copyTo(File(destination, source.name), overwrite = true)
            }
            if (primaryTakesFile.isFile) primaryTakesFile.copyTo(File(destination, primaryTakesFile.name), overwrite = true)
            val json = JSONObject().apply {
                put("bpm", settings.bpm)
                put("volumes", settings.volumes.joinToString(","))
                put("muted", settings.muted.joinToString(","))
                put("solo", settings.solo.joinToString(","))
                put("looped", settings.looped.joinToString(","))
            }.toString()
            File(destination, "project.json").writeText(json)
            File(projectDir, "project.json").writeText(json)
            true
        }.getOrDefault(false)
        if (!saved) return false

        rememberCurrentProject(safeName)
        // Saving the editable multitrack project must not fail just because
        // Android/FFmpeg cannot publish the optional MP3 copy.
        val mp3Published = publishProjectMp3(settings, safeName)
        if (!mp3Published) {
            android.util.Log.w("MerylStudio", "Project saved but MP3 publication failed: $safeName")
        }
        return true
    }

    fun loadProject(name: String): Boolean {
        if (recording.get()) return false
        val sourceDir = File(savedProjectsDir, name)
        if (!sourceDir.isDirectory) return false
        val loaded = runCatching {
            stopPlayback()
            deleteAllTracks()
            repeat(STUDIO_TRACK_COUNT) { index ->
                val source = File(sourceDir, "track_" + (index + 1) + ".wav")
                if (source.isFile) source.copyTo(trackFile(index), overwrite = true)
            }
            val savedTakes = File(sourceDir, primaryTakesFile.name)
            if (savedTakes.isFile) savedTakes.copyTo(primaryTakesFile, overwrite = true)
            else primaryTakesFile.delete()
            File(sourceDir, "project.json").takeIf { it.isFile }
                ?.copyTo(File(projectDir, "project.json"), overwrite = true)
            true
        }.getOrDefault(false)
        if (loaded) rememberCurrentProject(name)
        return loaded
    }

    fun loadProjectSettings(): StudioMixSettings? {
        val file = File(projectDir, "project.json")
        if (!file.isFile) return null
        return runCatching {
            val json = JSONObject(file.readText())
            fun floats(key: String) = json.optString(key).split(",").mapNotNull { it.toFloatOrNull() }
            fun bools(key: String) = json.optString(key).split(",").map { it.toBoolean() }
            StudioMixSettings(
                volumes = floats("volumes"),
                muted = bools("muted"),
                solo = bools("solo"),
                looped = bools("looped"),
                bpm = json.optInt("bpm", 120)
            )
        }.getOrNull()
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

    private fun publishProjectMp3(settings: StudioMixSettings, requestedName: String): Boolean {
        val selected = selectedTrackIndexes(settings, excludeTrack = -1)
        if (selected.isEmpty()) return false

        val maxSamples = selected.maxOfOrNull { index ->
            StudioPcmSource.cycleSamples(
                trackFile(index),
                looped = index > 0 && settings.looped.getOrElse(index) { false },
                bpm = settings.bpm
            )
        } ?: return false
        if (maxSamples <= 0L) return false

        val tempWav = File(projectDir, "visible_project_mix.tmp.wav")
        val tempMp3 = File(projectDir, "visible_project_mix.tmp.mp3")
        runCatching { tempWav.delete() }
        runCatching { tempMp3.delete() }

        val sources = selected.map { index ->
            MixSource(
                audio = StudioPcmSource(
                    file = trackFile(index),
                    looped = index > 0 && settings.looped.getOrElse(index) { false },
                    bpm = settings.bpm,
                    startSample = 0L
                ),
                volume = settings.volumes.getOrElse(index) { 1f }.coerceIn(0f, 1f)
            )
        }

        val mixed = runCatching {
            BufferedOutputStream(FileOutputStream(tempWav)).use { output ->
                writeWavHeader(output, maxSamples * 2L)
                val blockSamples = 2048
                val sourceBuffers = sources.map { ShortArray(blockSamples) }
                val writeBuffer = ByteArray(blockSamples * 2)
                var processed = 0L

                while (processed < maxSamples) {
                    val count = minOf(blockSamples.toLong(), maxSamples - processed).toInt()
                    sources.forEachIndexed { i, source ->
                        readSamples(source, sourceBuffers[i], count)
                    }

                    var byteIndex = 0
                    for (sampleIndex in 0 until count) {
                        var mixedSample = 0f
                        sources.forEachIndexed { sourceIndex, source ->
                            mixedSample += sourceBuffers[sourceIndex][sampleIndex] * source.volume
                        }
                        val clipped = mixedSample.roundToInt().coerceIn(-32768, 32767)
                        writeBuffer[byteIndex++] = (clipped and 0xFF).toByte()
                        writeBuffer[byteIndex++] = ((clipped shr 8) and 0xFF).toByte()
                    }
                    output.write(writeBuffer, 0, count * 2)
                    processed += count
                }
            }
            true
        }.getOrDefault(false)
        sources.forEach { runCatching { it.audio.close() } }

        if (!mixed || !tempWav.isFile || tempWav.length() <= WAV_HEADER_SIZE) {
            runCatching { tempWav.delete() }
            return false
        }

        val quote: (String) -> String = { path ->
            "'" + path.replace("'", "'\\''") + "'"
        }
        val command = listOf(
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", quote(tempWav.absolutePath),
            "-vn",
            "-codec:a", "libmp3lame",
            "-b:a", "192k",
            "-ar", STUDIO_SAMPLE_RATE.toString(),
            "-ac", "1",
            quote(tempMp3.absolutePath)
        ).joinToString(" ")

        val encoded = runCatching {
            val session = FFmpegKit.execute(command)
            ReturnCode.isSuccess(session.returnCode) &&
                tempMp3.isFile &&
                tempMp3.length() > 0L
        }.getOrDefault(false)

        runCatching { tempWav.delete() }
        if (!encoded) {
            runCatching { tempMp3.delete() }
            return false
        }

        val cleanedBase = requestedName
            .trim()
            .removeSuffix(".mp3")
            .removeSuffix(".MP3")
            .replace(Regex("[\\\\/:*?\"<>|]"), "_")
            .ifBlank { "MerylStudio" }
        val displayName = "$cleanedBase.mp3"
        val relativePath = "Music/MerylStudio/"
        val resolver = context.contentResolver

        val existingUri = runCatching {
            resolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.Audio.Media._ID),
                "${MediaStore.Audio.Media.DISPLAY_NAME}=? AND ${MediaStore.Audio.Media.RELATIVE_PATH}=?",
                arrayOf(displayName, relativePath),
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID))
                    ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)
                } else null
            }
        }.getOrNull()

        // A MediaStore row created by an older installation may no longer be writable
        // after an Android / One UI update. Never assume that finding it grants write access.
        val canUpdateExisting = existingUri?.let { candidate ->
            runCatching {
                resolver.update(
                    candidate,
                    ContentValues().apply {
                        put(MediaStore.Audio.Media.IS_PENDING, 1)
                        put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
                    },
                    null,
                    null
                ) > 0
            }.getOrDefault(false)
        } ?: false

        val creatingNew = !canUpdateExisting
        val targetName = if (existingUri != null && creatingNew) {
            "$cleanedBase" + "_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE)
                .format(Date()) + ".mp3"
        } else displayName

        val uri = if (canUpdateExisting) existingUri else runCatching {
            resolver.insert(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                ContentValues().apply {
                    put(MediaStore.Audio.Media.DISPLAY_NAME, targetName)
                    put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
                    put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)
                    put(MediaStore.Audio.Media.IS_MUSIC, 1)
                    put(MediaStore.Audio.Media.IS_PENDING, 1)
                }
            )
        }.getOrNull()
        if (uri == null) {
            runCatching { tempMp3.delete() }
            return false
        }

        val copied = runCatching {
            resolver.openOutputStream(uri, "w")?.use { output ->
                FileInputStream(tempMp3).use { input -> input.copyTo(output) }
            } ?: error("No output stream")
            true
        }.getOrDefault(false)
        runCatching { tempMp3.delete() }

        if (!copied) {
            if (creatingNew) runCatching { resolver.delete(uri, null, null) }
            return false
        }

        runCatching {
            resolver.update(
                uri,
                ContentValues().apply {
                    put(MediaStore.Audio.Media.IS_PENDING, 0)
                    put(MediaStore.Audio.Media.IS_MUSIC, 1)
                },
                null,
                null
            )
        }
        return true
    }

    fun removeLongSilences(index: Int): Long {
        if (recording.get() || index !in 0 until STUDIO_TRACK_COUNT) return -1L
        val source = trackFile(index)
        if (!source.isFile || source.length() <= WAV_HEADER_SIZE) return -1L

        stopPlayback()

        val tempRaw = File(projectDir, "track_" + (index + 1) + ".silence.tmp.raw")
        runCatching { tempRaw.delete() }

        val frameSamples = (STUDIO_SAMPLE_RATE / 50).coerceAtLeast(1) // 20 ms
        val frameBytes = frameSamples * 2
        val minSilentFrames = 25 // 500 ms minimum
        val keepEdgeFrames = 5   // keep 100 ms at each side of a removed gap
        val rmsThreshold = 420.0

        var removedBytes = 0L
        var longSilence = false
        val pending = mutableListOf<ByteArray>()
        val tail = mutableListOf<ByteArray>()

        val ok = runCatching {
            BufferedInputStream(FileInputStream(source)).use { input ->
                skipFully(input, WAV_HEADER_SIZE.toLong())
                BufferedOutputStream(FileOutputStream(tempRaw)).use { output ->
                    val frame = ByteArray(frameBytes)

                    fun writeFrames(frames: List<ByteArray>) {
                        frames.forEach { output.write(it) }
                    }

                    fun isSilent(bytes: ByteArray): Boolean {
                        var i = 0
                        var count = 0
                        var sumSquares = 0.0
                        while (i + 1 < bytes.size) {
                            val lo = bytes[i].toInt() and 0xFF
                            val hi = bytes[i + 1].toInt()
                            val sample = ((hi shl 8) or lo).toShort().toInt()
                            sumSquares += sample.toDouble() * sample.toDouble()
                            count++
                            i += 2
                        }
                        if (count == 0) return true
                        return sqrt(sumSquares / count.toDouble()) < rmsThreshold
                    }

                    while (true) {
                        var read = 0
                        while (read < frame.size) {
                            val n = input.read(frame, read, frame.size - read)
                            if (n <= 0) break
                            read += n
                        }
                        if (read <= 0) break
                        val evenRead = read - (read % 2)
                        if (evenRead <= 0) break
                        val chunk = frame.copyOf(evenRead)

                        if (isSilent(chunk)) {
                            if (!longSilence) {
                                pending.add(chunk)
                                if (pending.size >= minSilentFrames) {
                                    longSilence = true
                                    val startKeep = minOf(keepEdgeFrames, pending.size)
                                    val tailStart = maxOf(startKeep, pending.size - keepEdgeFrames)

                                    for (i in 0 until startKeep) output.write(pending[i])
                                    for (i in startKeep until tailStart) {
                                        removedBytes += pending[i].size.toLong()
                                    }
                                    for (i in tailStart until pending.size) tail.add(pending[i])
                                    pending.clear()
                                }
                            } else {
                                tail.add(chunk)
                                while (tail.size > keepEdgeFrames) {
                                    removedBytes += tail.removeAt(0).size.toLong()
                                }
                            }
                        } else {
                            if (longSilence) {
                                writeFrames(tail)
                                tail.clear()
                                longSilence = false
                            } else {
                                writeFrames(pending)
                                pending.clear()
                            }
                            output.write(chunk)
                        }

                        if (read < frame.size) break
                    }

                    if (longSilence) writeFrames(tail) else writeFrames(pending)
                }
            }
            true
        }.getOrDefault(false)

        if (!ok) {
            runCatching { tempRaw.delete() }
            return -1L
        }
        if (removedBytes <= 0L) {
            runCatching { tempRaw.delete() }
            return 0L
        }

        return runCatching {
            writeWavFromRaw(tempRaw, source)
            removedBytes / 2L * 1000L / STUDIO_SAMPLE_RATE
        }.getOrElse { -1L }.also {
            runCatching { tempRaw.delete() }
        }
    }

    fun exportMix(settings: StudioMixSettings, requestedName: String): Uri? {
        val selected = selectedTrackIndexes(settings, excludeTrack = -1)
        if (selected.isEmpty()) return null

        val maxSamples = selected.maxOfOrNull { index ->
            StudioPcmSource.cycleSamples(
                trackFile(index),
                looped = index > 0 && settings.looped.getOrElse(index) { false },
                bpm = settings.bpm
            )
        } ?: return null
        if (maxSamples <= 0L) return null

        val tempMix = File(projectDir, "mix_export.tmp.wav")
        val sources = selected.map { index ->
            MixSource(
                audio = StudioPcmSource(
                    file = trackFile(index),
                    looped = index > 0 && settings.looped.getOrElse(index) { false },
                    bpm = settings.bpm,
                    startSample = 0L
                ),
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
                        readSamples(source, sourceBuffers[i], count)
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
            sources.forEach { runCatching { it.audio.close() } }
        }

        val cleanedBase = requestedName
            .trim()
            .removeSuffix(".wav")
            .removeSuffix(".WAV")
            .removeSuffix(".mp3")
            .removeSuffix(".MP3")
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
        val name = cleanedBase + ".mp3"
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
            put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/MerylStudio")
            put(MediaStore.Audio.Media.IS_MUSIC, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }

        // Android's platform codecs do not provide a reliable MP3 encoder on all devices.
        // Encode the 44.1 kHz mono studio mix to AAC at 192 kb/s, then store it as M4A.
        // This keeps a genuine 192 kb/s compressed audio file instead of merely renaming WAV.
        val encodedName = cleanedBase + ".m4a"
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, encodedName)
        values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
        val encoded = File(projectDir, "mix_export.tmp.m4a")
        if (!encodeWavToAacM4a(tempMix, encoded, 192_000)) {
            runCatching { tempMix.delete() }
            return null
        }
        val resolver = context.contentResolver
        val uri = runCatching {
            resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
        }.getOrNull() ?: run {
            runCatching { tempMix.delete() }
            runCatching { encoded.delete() }
            return null
        }
        val copied = runCatching {
            resolver.openOutputStream(uri)?.use { output ->
                FileInputStream(encoded).use { input -> input.copyTo(output) }
            } ?: error("No output stream")
            true
        }.getOrDefault(false)
        runCatching { tempMix.delete() }
        runCatching { encoded.delete() }
        if (!copied) {
            runCatching { resolver.delete(uri, null, null) }
            return null
        }
        runCatching {
            resolver.update(uri, ContentValues().apply {
                put(MediaStore.Audio.Media.IS_PENDING, 0)
            }, null, null)
        }
        return uri
    }

    private fun encodeWavToAacM4a(wav: File, output: File, bitrate: Int): Boolean {
        if (!wav.isFile || wav.length() <= WAV_HEADER_SIZE) return false
        return runCatching {
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, STUDIO_SAMPLE_RATE, 1).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
            }
            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            if (output.exists()) output.delete()
            val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var muxerStarted = false
            var trackIndex = -1
            val info = MediaCodec.BufferInfo()
            BufferedInputStream(FileInputStream(wav)).use { input ->
                skipFully(input, WAV_HEADER_SIZE.toLong())
                var inputDone = false
                var outputDone = false
                var totalPcmBytes = 0L
                while (!outputDone) {
                    if (!inputDone) {
                        val inputIndex = codec.dequeueInputBuffer(10_000)
                        if (inputIndex >= 0) {
                            val buffer = codec.getInputBuffer(inputIndex)!!
                            buffer.clear()
                            val bytes = ByteArray(minOf(buffer.remaining(), 16384))
                            val read = input.read(bytes)
                            if (read <= 0) {
                                val pts = totalPcmBytes * 1_000_000L / (STUDIO_SAMPLE_RATE * 2L)
                                codec.queueInputBuffer(inputIndex, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                buffer.put(bytes, 0, read)
                                val pts = totalPcmBytes * 1_000_000L / (STUDIO_SAMPLE_RATE * 2L)
                                codec.queueInputBuffer(inputIndex, 0, read, pts, 0)
                                totalPcmBytes += read
                            }
                        }
                    }
                    val outputIndex = codec.dequeueOutputBuffer(info, 10_000)
                    when {
                        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            trackIndex = muxer.addTrack(codec.outputFormat)
                            muxer.start()
                            muxerStarted = true
                        }
                        outputIndex >= 0 -> {
                            val buffer = codec.getOutputBuffer(outputIndex)!!
                            if (info.size > 0 && muxerStarted) {
                                buffer.position(info.offset)
                                buffer.limit(info.offset + info.size)
                                muxer.writeSampleData(trackIndex, buffer, info)
                            }
                            outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                            codec.releaseOutputBuffer(outputIndex, false)
                        }
                    }
                }
            }
            codec.stop()
            codec.release()
            if (muxerStarted) muxer.stop()
            muxer.release()
            output.isFile && output.length() > 0L
        }.getOrDefault(false)
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

    private fun streamWavFile(
        file: File,
        volume: Float,
        startOffsetMs: Long,
        looped: Boolean,
        bpm: Int,
        generation: Int
    ) {
        if (!file.isFile || file.length() <= WAV_HEADER_SIZE + 1L) return
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
            val startSample = startOffsetMs.coerceAtLeast(0L) *
                STUDIO_SAMPLE_RATE.toLong() / 1000L
            StudioPcmSource(file, looped, bpm, startSample).use { audio ->
                player.setVolume(volume)
                player.play()
                val buffer = ByteArray(4096 * 2)
                while (playbackGeneration.get() == generation &&
                    !Thread.currentThread().isInterrupted
                ) {
                    val count = audio.readBytes(buffer, 0, buffer.size)
                    if (count <= 0) break
                    var written = 0
                    while (written < count &&
                        playbackGeneration.get() == generation &&
                        !Thread.currentThread().isInterrupted
                    ) {
                        val n = player.write(buffer, written, count - written)
                        if (n <= 0) break
                        written += n
                    }
                    if (written < count) break
                }
            }
        } catch (_: Throwable) {
        } finally {
            runCatching { player.stop() }
            runCatching { player.release() }
        }
    }

    private fun appendRawToWav(raw: File, destination: File) {
        if (!destination.isFile || destination.length() <= WAV_HEADER_SIZE) {
            writeWavFromRaw(raw, destination)
            return
        }
        val existingDataLength = (destination.length() - WAV_HEADER_SIZE).coerceAtLeast(0L)
        val newDataLength = raw.length()
        val tempWav = File(destination.parentFile, destination.name + ".append.tmp")
        BufferedOutputStream(FileOutputStream(tempWav)).use { output ->
            writeWavHeader(output, existingDataLength + newDataLength)
            BufferedInputStream(FileInputStream(destination)).use { input ->
                skipFully(input, WAV_HEADER_SIZE.toLong())
                input.copyTo(output)
            }
            FileInputStream(raw).use { input -> input.copyTo(output) }
        }
        if (destination.exists()) destination.delete()
        if (!tempWav.renameTo(destination)) {
            tempWav.copyTo(destination, overwrite = true)
            tempWav.delete()
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
        source: MixSource,
        destination: ShortArray,
        requested: Int
    ) {
        java.util.Arrays.fill(destination, 0.toShort())
        val bytes = ByteArray(requested * 2)
        val total = source.audio.readBytes(bytes, 0, bytes.size)
        var offset = 0
        var sample = 0
        while (offset + 1 < total && sample < requested) {
            val lo = bytes[offset].toInt() and 0xFF
            val hi = bytes[offset + 1].toInt()
            destination[sample] = ((hi shl 8) or lo).toShort()
            offset += 2
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
        val audio: StudioPcmSource,
        val volume: Float
    )
}

/**
 * PCM reader shared by playback and WAV mixdown.
 * Loop boundaries are quantized to whole beats in PCM samples (not timed using
 * repeated Android thread delays), so successive repetitions do not accumulate
 * scheduling drift. Audio past the chosen beat is trimmed; a short ending is
 * zero-padded until that beat. No time-stretching or pitch shifting is applied.
 */
private class StudioPcmSource(
    private val file: File,
    private val looped: Boolean,
    bpm: Int,
    startSample: Long
) : java.io.Closeable {
    companion object {
        fun cycleSamples(file: File, looped: Boolean, bpm: Int): Long {
            val samples = ((file.length() - WAV_HEADER_SIZE).coerceAtLeast(0L) / 2L)
            if (!looped || samples <= 0L) return samples
            val perBeat = (STUDIO_SAMPLE_RATE * 60.0 / bpm.coerceIn(30, 300))
                .roundToLong().coerceAtLeast(1L)
            val beats = (samples.toDouble() / perBeat.toDouble())
                .roundToLong().coerceAtLeast(1L)
            return beats * perBeat
        }
    }

    private val fileSamples = ((file.length() - WAV_HEADER_SIZE).coerceAtLeast(0L) / 2L)
    private val cycle = cycleSamples(file, looped, bpm)
    private var position = if (looped && cycle > 0L) startSample % cycle
        else startSample.coerceIn(0L, cycle)
    private var input: BufferedInputStream? = null

    init {
        openAt(position)
    }

    private fun openAt(sample: Long) {
        input?.close()
        input = BufferedInputStream(FileInputStream(file))
        skipFully(input!!, WAV_HEADER_SIZE.toLong() +
            sample.coerceAtMost(fileSamples) * 2L)
    }

    fun readBytes(destination: ByteArray, offset: Int, length: Int): Int {
        require(length % 2 == 0 && offset >= 0 &&
            length >= 0 && offset + length <= destination.size)
        var written = 0
        while (written < length) {
            if (position >= cycle) {
                if (!looped || cycle <= 0L) break
                position = 0L
                openAt(0L)
            }
            val frames = minOf(((length - written) / 2).toLong(), cycle - position)
                .toInt()
            if (frames <= 0) break
            val byteCount = frames * 2
            if (position >= fileSamples) {
                java.util.Arrays.fill(
                    destination, offset + written,
                    offset + written + byteCount, 0.toByte()
                )
                position += frames
                written += byteCount
                continue
            }

            val audioFrames = minOf(frames.toLong(), fileSamples - position).toInt()
            val expected = audioFrames * 2
            var obtained = 0
            while (obtained < expected) {
                val n = input!!.read(
                    destination,
                    offset + written + obtained,
                    expected - obtained
                )
                if (n <= 0) break
                obtained += n
            }
            if (obtained < expected) {
                java.util.Arrays.fill(
                    destination, offset + written + obtained,
                    offset + written + expected, 0.toByte()
                )
            }
            position += audioFrames
            written += expected
        }
        return written
    }

    override fun close() {
        input?.close()
        input = null
    }

    // Avoid holding an engine instance merely to seek a WAV data stream.
    private fun skipFully(stream: BufferedInputStream, bytes: Long) {
        var remaining = bytes
        while (remaining > 0L) {
            val skipped = stream.skip(remaining)
            if (skipped > 0L) remaining -= skipped
            else if (stream.read() >= 0) remaining--
            else break
        }
    }
}
