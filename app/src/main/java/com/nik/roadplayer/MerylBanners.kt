package com.nik.roadplayer

import android.graphics.BitmapFactory
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import java.io.File

enum class MerylBannerKind { CAR_AUDIO, MINI_STUDIO }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MerylBanner(kind: MerylBannerKind, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val imageFile = remember(context) { File(context.filesDir, "shared_meryl_banner.png") }
    var revision by remember { mutableStateOf(0) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val bitmap = BitmapFactory.decodeStream(input) ?: error("Image invalide")
                    imageFile.outputStream().use { output ->
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 95, output)
                    }
                    revision++
                }
            }
        }
    }
    val bitmap = remember(revision) {
        if (imageFile.isFile) BitmapFactory.decodeFile(imageFile.absolutePath) else null
    }
    val decorated = modifier.combinedClickable(
        onClick = {},
        onLongClick = { picker.launch("image/*") }
    )
    if (bitmap != null) {
        Image(bitmap = bitmap.asImageBitmap(), contentDescription = "Bandeau Meryl Car Audio (appui long pour modifier)", modifier = decorated, contentScale = ContentScale.Fit)
    } else {
        Image(painter = painterResource(id = R.drawable.bando_haut), contentDescription = "Bandeau Meryl Car Audio (appui long pour modifier)", modifier = decorated, contentScale = ContentScale.Fit)
    }
}
