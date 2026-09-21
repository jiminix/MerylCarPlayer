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
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
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
import java.io.DataOutputStream
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

private const val STUDIO_TRACK_COUNT = 5
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

    val volumes = remember { mutableStateListOf(1f, 1f, 1f, 1f, 1f) }
    val muted = remember { mutableStateListOf(false, false, false, false, false) }
    val solo = remember { mutableStateListOf(false, false, false, false, false) }
    val existing = remember { mutableStateListOf(false, false, false, false, false) }
    val durations = remember { mutableStateListOf(0L, 0L, 0L, 0L, 0L) }
    val peaks = remember {
        mutableStateListOf(
            emptyList<Float>(),
            emptyList(),
            emptyList(),
            emptyList(),
            emptyList()
        )
    }

    var recordingTrack by remember { mutableStateOf<Int?>(null) }
    var playing by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var playbackDuration by remember { mutableStateOf(0L) }
    var pendingRecord by remember { mutableStateOf<Int?>(null) }

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
                    engine.trackPeaks(index, 64)
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
        val started = engine.startRecording(index, settings())
        if (!started) {
            Toast.makeText(context, "Impossible de démarrer le micro", Toast.LENGTH_LONG).show()
            return
        }
        recordingTrack = index
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

    LaunchedEffect(Unit) {
        repeat(STUDIO_TRACK_COUNT) { refreshTrack(it) }
    }

    LaunchedEffect(playing, playbackDuration) {
        if (playing && playbackDuration > 0L) {
            delay(playbackDuration + 120L)
            if (playing) {
                engine.stopPlayback()
                playing = false
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            engine.stopAll()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF10171B))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(Color(0xFF202830))
                .padding(horizontal = 8.dp),
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
            Spacer(Modifier.size(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "MERYL STUDIO",
                    color = Color(0xFFFFDE59),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold
                )
                Text(
                    text = "5 pistes · overdub",
                    color = Color(0xFFAEB9C0),
                    fontSize = 10.sp
                )
            }
            if (recordingTrack != null) {
                Text(
                    text = "● REC " + (recordingTrack!! + 1),
                    color = Color(0xFFFF6B6B),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF151D22))
                .padding(horizontal = 8.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            StudioTransportButton(
                text = if (playing) "■" else "▶",
                enabled = recordingTrack == null && existing.any { it } && !exporting,
                modifier = Modifier.weight(1f)
            ) {
                if (playing) {
                    engine.stopPlayback()
                    playing = false
                } else {
                    val duration = engine.startPlayback(settings())
                    if (duration > 0L) {
                        playbackDuration = duration
                        playing = true
                    }
                }
            }

            StudioTransportButton(
                text = "■ STOP",
                enabled = recordingTrack != null || playing,
                modifier = Modifier.weight(1f)
            ) {
                if (recordingTrack != null) {
                    val stoppedTrack = recordingTrack
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            engine.stopRecordingBlocking()
                        }
                        recordingTrack = null
                        stoppedTrack?.let { refreshTrack(it) }
                    }
                } else {
                    engine.stopPlayback()
                    playing = false
                }
            }

            StudioTransportButton(
                text = if (exporting) "MIX..." else "EXPORT",
                enabled = recordingTrack == null && existing.any { it } && !exporting,
                modifier = Modifier.weight(1f)
            ) {
                exporting = true
                playing = false
                engine.stopPlayback()
                scope.launch {
                    val uri = withContext(Dispatchers.IO) {
                        engine.exportMix(settings())
                    }
                    exporting = false
                    Toast.makeText(
                        context,
                        if (uri != null) "Mix enregistré dans Music/MerylStudio" else "Export impossible",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        Text(
            text = "Pour un overdub propre, utilise de préférence des écouteurs : les pistes déjà enregistrées sont jouées pendant le nouvel enregistrement.",
            color = Color(0xFF93A2AA),
            fontSize = 10.sp,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 7.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            items((0 until STUDIO_TRACK_COUNT).toList()) { index ->
                val isRecording = recordingTrack == index
                StudioTrackRow(
                    index = index,
                    hasAudio = existing[index],
                    durationMs = durations[index],
                    waveform = peaks[index],
                    volume = volumes[index],
                    muted = muted[index],
                    solo = solo[index],
                    recording = isRecording,
                    controlsEnabled = recordingTrack == null && !exporting,
                    onVolume = { volumes[index] = it },
                    onMute = { muted[index] = !muted[index] },
                    onSolo = { solo[index] = !solo[index] },
                    onRecord = {
                        if (ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED
                        ) {
                            beginRecording(index)
                        } else {
                            pendingRecord = index
                            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    onClear = {
                        engine.deleteTrack(index)
                        existing[index] = false
                        durations[index] = 0L
                        peaks[index] = emptyList()
                    }
                )
            }
            item {
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun StudioTrackRow(
    index: Int,
    hasAudio: Boolean,
    durationMs: Long,
    waveform: List<Float>,
    volume: Float,
    muted: Boolean,
    solo: Boolean,
    recording: Boolean,
    controlsEnabled: Boolean,
    onVolume: (Float) -> Unit,
    onMute: () -> Unit,
    onSolo: () -> Unit,
    onRecord: () -> Unit,
    onClear: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF1A2329), RoundedCornerShape(12.dp))
            .padding(horizontal = 8.dp, vertical = 7.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "PISTE " + (index + 1),
                color = if (recording) Color(0xFFFF6B6B) else Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            if (hasAudio) {
                Text(
                    text = formatStudioDuration(durationMs),
                    color = Color(0xFF9BAAB2),
                    fontSize = 10.sp,
                    modifier = Modifier.padding(end = 6.dp)
                )
            }

            StudioMiniButton(
                text = if (recording) "●" else "REC",
                active = recording,
                enabled = controlsEnabled || recording,
                activeColor = Color(0xFFB82020),
                onClick = onRecord
            )
            Spacer(Modifier.size(4.dp))
            StudioMiniButton(
                text = "M",
                active = muted,
                enabled = controlsEnabled,
                activeColor = Color(0xFFD38A19),
                onClick = onMute
            )
            Spacer(Modifier.size(4.dp))
            StudioMiniButton(
                text = "S",
                active = solo,
                enabled = controlsEnabled,
                activeColor = Color(0xFF2E7D5A),
                onClick = onSolo
            )
            Spacer(Modifier.size(4.dp))
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
                .height(34.dp)
                .background(Color(0xFF0D1418), RoundedCornerShape(7.dp))
                .padding(horizontal = 4.dp)
        ) {
            StudioWaveform(
                peaks = waveform,
                active = hasAudio,
                recording = recording,
                modifier = Modifier.fillMaxSize()
            )
            if (!hasAudio && !recording) {
                Text(
                    text = "Vide — appuie sur REC",
                    color = Color(0xFF5F6C72),
                    fontSize = 10.sp,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(30.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "VOL",
                color = Color(0xFF8D9AA0),
                fontSize = 9.sp,
                modifier = Modifier.size(width = 28.dp, height = 18.dp)
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
                color = Color(0xFFC4CDD1),
                fontSize = 9.sp,
                textAlign = TextAlign.End,
                modifier = Modifier.size(width = 28.dp, height = 18.dp)
            )
        }
    }
}

@Composable
private fun StudioWaveform(
    peaks: List<Float>,
    active: Boolean,
    recording: Boolean,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        if (peaks.isEmpty()) return@Canvas
        val center = size.height / 2f
        val step = size.width / peaks.size.coerceAtLeast(1)
        val maxHalf = size.height * 0.43f
        val waveColor = when {
            recording -> Color(0xFFFF5E5E)
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
                strokeWidth = max(1f, step * 0.42f),
                cap = StrokeCap.Round
            )
        }
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
            .size(38.dp)
            .background(
                if (enabled) Color(0xFF303A40) else Color(0xFF1B2226),
                RoundedCornerShape(10.dp)
            )
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = if (enabled) Color.White else Color(0xFF5C666B),
            fontSize = 22.sp,
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
        excludeTrack: Int = -1
    ): Long {
        stopPlayback()
        val selected = selectedTrackIndexes(settings, excludeTrack)
        if (selected.isEmpty()) return 0L
        playbackStop.set(false)

        selected.forEach { index ->
            val file = trackFile(index)
            val volume = settings.volumes.getOrElse(index) { 1f }.coerceIn(0f, 1f)
            val thread = Thread {
                streamWavFile(file, volume)
            }
            thread.name = "MerylStudioPlay-" + (index + 1)
            playbackThreads.add(thread)
            thread.start()
        }

        return selected.maxOfOrNull { trackDurationMs(it) } ?: 0L
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

    fun exportMix(settings: StudioMixSettings): Uri? {
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

        val name = "MerylStudio_" +
            SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE).format(Date()) +
            ".wav"
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

    private fun streamWavFile(file: File, volume: Float) {
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
                skipFully(input, WAV_HEADER_SIZE.toLong())
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
