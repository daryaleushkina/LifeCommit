// Разбор ссылок-приглашений (AppModel.invitePath): все ветки — что попадёт в путь API, решает только он.
package app.lifecommit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InvitePathTest {
    @Test fun `ссылки приложения и сайта - вид и код`() {
        assertEquals("join" to "abcd1234", AppModel.invitePath("https://lifecommit.app/j/abcd1234"))
        assertEquals("friend" to "abcd1234", AppModel.invitePath("https://lifecommit.app/f/abcd1234"))
        assertEquals("join" to "ab-_12", AppModel.invitePath("lifecommit://join/ab-_12"))
        assertEquals("friend" to "abcd1234", AppModel.invitePath("lifecommit://friend/abcd1234"))
        assertEquals("join" to "a".repeat(64), AppModel.invitePath("https://lifecommit.app/j/" + "a".repeat(64)))
    }

    @Test fun `код только из букв, цифр, «-» и «_», от 4 до 64`() {
        assertNull(AppModel.invitePath("lifecommit://join/.."))
        assertNull(AppModel.invitePath("https://lifecommit.app/j/.."))
        assertNull(AppModel.invitePath("https://lifecommit.app/j/abc"))
        assertNull(AppModel.invitePath("https://lifecommit.app/j/" + "a".repeat(65)))
        assertNull(AppModel.invitePath("https://lifecommit.app/j/ab%2Fcd"))
        assertNull(AppModel.invitePath("lifecommit://join/ab.cd"))
        assertNull(AppModel.invitePath("lifecommit://join/"))
    }

    @Test fun `чужие схемы, хосты и пути - не приглашение`() {
        assertNull(AppModel.invitePath("http://lifecommit.app/j/abcd1234"))
        assertNull(AppModel.invitePath("https://evil.example/j/abcd1234"))
        assertNull(AppModel.invitePath("https://lifecommit.app.evil.example/j/abcd1234"))
        assertNull(AppModel.invitePath("https://lifecommit.app/x/abcd1234"))
        assertNull(AppModel.invitePath("https://lifecommit.app/j/abcd1234/more"))
        assertNull(AppModel.invitePath("lifecommit://join/a/b"))
        assertNull(AppModel.invitePath("lifecommit://calendars?status=ok"))
        assertNull(AppModel.invitePath("lifecommit://other/abcd1234"))
        assertNull(AppModel.invitePath("not a uri at all ::"))
    }
}
