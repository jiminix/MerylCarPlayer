package com.nik.roadplayer

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

// The archive contains the app's private files and preferences, never another app's sandbox.
private object MerylBackup {
    fun export(context: Context, uri: Uri): Int {
        val roots = listOf("files" to context.filesDir, "shared_prefs" to File(context.applicationInfo.dataDir, "shared_prefs"))
        var count = 0
        context.contentResolver.openOutputStream(uri)?.use { output ->
            ZipOutputStream(output).use { zip ->
                roots.forEach { (prefix, dir) ->
                    if (dir.isDirectory) dir.walkTopDown().filter { it.isFile }.forEach { file ->
                        val relative = file.relativeTo(dir).invariantSeparatorsPath
                        zip.putNextEntry(ZipEntry("$prefix/$relative"))
                        file.inputStream().use { it.copyTo(zip) }
                        zip.closeEntry()
                        count++
                    }
                }
            }
        } ?: error("Impossible d'ouvrir le fichier de sauvegarde")
        return count
    }


    fun importStudioProject(context: Context, uri: Uri): Int {
        val saved = File(context.filesDir, "meryl_studio/saved_projects").apply { mkdirs() }
        val cursor = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
        val originalName = cursor?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Projet.zip"
        val base = originalName.substringBeforeLast('.').replace(Regex("[^a-zA-Z0-9 _-]"), "_").ifBlank { "Projet" }
        var name = base
        var number = 2
        while (File(saved, name).exists()) { name = base + " (" + number++ + ")" }
        val destination = File(saved, name).apply { mkdirs() }
        var count = 0
        try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                ZipInputStream(input).use { zip ->
                    var entry = zip.nextEntry
                    while (entry != null) {
                        val target = File(destination, entry.name)
                        if (!target.canonicalPath.startsWith(destination.canonicalPath + File.separator)) error("Chemin interdit")
                        if (!entry.isDirectory) {
                            target.parentFile?.mkdirs()
                            target.outputStream().use { zip.copyTo(it) }
                            count++
                        }
                        zip.closeEntry()
                        entry = zip.nextEntry
                    }
                }
            } ?: error("Archive inaccessible")
            if (!File(destination, "project.json").isFile) error("Ce ZIP n'est pas un projet Studio")
            return count
        } catch (e: Exception) {
            destination.deleteRecursively()
            throw e
        }
    }

    fun import(context: Context, uri: Uri): Pair<Int, Int> {
        val roots = mapOf("files" to context.filesDir, "shared_prefs" to File(context.applicationInfo.dataDir, "shared_prefs"))
        var imported = 0
        var skipped = 0
        context.contentResolver.openInputStream(uri)?.use { input ->
            ZipInputStream(input).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    val parts = entry.name.replace('\\', '/').split('/')
                    val root = roots[parts.firstOrNull()]
                    if (root == null || parts.size < 2 || parts.drop(1).any { it.isBlank() || it == "." || it == ".." }) {
                        skipped++
                    } else if (!entry.isDirectory) {
                        val destination = File(root, parts.drop(1).joinToString("/"))
                        if (!destination.canonicalPath.startsWith(root.canonicalPath + File.separator) || destination.exists()) {
                            skipped++
                        } else {
                            destination.parentFile?.mkdirs()
                            destination.outputStream().use { zip.copyTo(it) }
                            imported++
                        }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
        } ?: error("Impossible de lire la sauvegarde")
        return imported to skipped
    }
}

@Composable
fun GeneralBackupButton() {
    val context = LocalContext.current
    var show by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) status = runCatching { "Sauvegarde créée : ${MerylBackup.export(context, uri)} fichiers" }
            .getOrElse { "Erreur export : ${it.message}" }
    }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) status = runCatching {
            val (added, skipped) = MerylBackup.import(context, uri)
            "$added fichiers récupérés, $skipped ignorés. Redémarre l'application."
        }.getOrElse { "Erreur import : ${it.message}" }
    }
    val studioImport = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) status = runCatching {
            "Projet Studio importé : " + MerylBackup.importStudioProject(context, uri) + " fichiers"
        }.getOrElse { "Erreur import Studio : " + it.message }
    }
    TextButton(onClick = { show = true }) { Text("Sauvegarde / Import général") }
    if (show) AlertDialog(
        onDismissRequest = { show = false },
        title = { Text("Sauvegarde générale") },
        text = {
            Column {
                Text("Exporte les fichiers privés et réglages de cette application. L'import ajoute les fichiers absents sans écraser ceux qui existent.")
                Button(onClick = { show = false; export.launch("MerylCarAudio-sauvegarde.zip") }) { Text("Exporter tout (ZIP)") }
                Button(onClick = { show = false; import.launch(arrayOf("application/zip", "application/octet-stream")) }) { Text("Importer un ZIP") }
                Button(onClick = { show = false; studioImport.launch(arrayOf("application/zip")) }) { Text("Importer ancien projet Studio (ZIP)") }
                if (status.isNotEmpty()) Text(status, modifier = Modifier.padding(top = 8.dp))
            }
        },
        confirmButton = { TextButton(onClick = { show = false }) { Text("Fermer") } }
    )
    if (!show && status.isNotEmpty()) TextButton(onClick = { show = true }) { Text("Résultat sauvegarde") }
}
