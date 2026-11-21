package com.nik.roadplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps Studio audio capture foreground-eligible while the screen locks or
 * another Activity temporarily covers the app. AudioRecord stays in the engine.
 */
class StudioRecordingService : Service() {
    companion object {
        private const val CHANNEL_ID = "meryl_studio_mic"
        private const val NOTIFICATION_ID = 1411
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID, "Microphone Meryl Studio", NotificationManager.IMPORTANCE_LOW
            )
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Meryl Studio 1.41")
            .setContentText("Enregistrement audio en cours")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY
    }
}
