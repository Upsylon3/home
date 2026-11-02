package com.homeecosystems.homesync.sync

import org.junit.Assert.*
import org.junit.Test

class MediaAccessTest {
    @Test fun `denial blocks enabled images and videos but not scoped downloads`() {
        val access = MediaAccess()
        val categories = BackupCategory.entries.toSet()
        assertEquals(setOf(BackupCategory.PHOTOS, BackupCategory.SCREENSHOTS, BackupCategory.VIDEOS), access.blockedCategories(categories).toSet())
        assertTrue(access.notice(categories)!!.startsWith("Media access is blocked"))
    }

    @Test fun `full access clears warning for all enabled categories`() {
        val access = MediaAccess(MediaScope.FULL, MediaScope.FULL)
        assertTrue(access.blockedCategories(BackupCategory.entries.toSet()).isEmpty())
        assertNull(access.notice(BackupCategory.entries.toSet()))
    }

    @Test fun `selected access permits a limited backup with a persistent warning`() {
        val access = MediaAccess(MediaScope.SELECTED, MediaScope.SELECTED)
        assertTrue(access.blockedCategories(BackupCategory.entries.toSet()).isEmpty())
        assertTrue(access.notice(setOf(BackupCategory.PHOTOS))!!.contains("Only selected"))
        assertTrue(access.notice(setOf(BackupCategory.VIDEOS))!!.contains("Only selected"))
        assertTrue(access.notice(setOf(BackupCategory.SCREENSHOTS))!!.contains("Only selected"))
    }

    @Test fun `mixed access requires review only for the missing enabled category`() {
        val access = MediaAccess(MediaScope.FULL, MediaScope.NONE)
        assertNull(access.notice(setOf(BackupCategory.PHOTOS)))
        assertEquals(listOf(BackupCategory.VIDEOS), access.blockedCategories(setOf(BackupCategory.PHOTOS, BackupCategory.VIDEOS)))
    }

    @Test fun `disabled categories do not produce irrelevant permission warnings`() {
        val access = MediaAccess(MediaScope.SELECTED, MediaScope.NONE)
        assertNull(access.notice(emptySet()))
        assertNull(access.notice(setOf(BackupCategory.DOWNLOADS)))
    }
}
