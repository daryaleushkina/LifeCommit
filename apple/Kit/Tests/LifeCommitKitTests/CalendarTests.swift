// Раздел «Календарь»: дни на экране, точки, «обновлено N мин назад», правка дела, возврат из Google, вызовы API.
import Foundation
import Testing
@testable import LifeCommitKit

@Suite("Календарь: дни и правки")
struct CalendarDaysTests {
    @Test("день — один день; месяц — целыми неделями с понедельника (октябрь 2026: 28 сентября … 1 ноября)")
    func range() {
        #expect(CalendarDays.range(.day, anchor: "2026-10-15") == ["2026-10-15"])
        let october = CalendarDays.range(.month, anchor: "2026-10-15")
        #expect(october.count == 35)
        #expect(october.first == "2026-09-28")
        #expect(october.last == "2026-11-01")
        // Февраль 2027 начинается в понедельник и кончается в воскресенье — ровно четыре недели.
        let february = CalendarDays.range(.month, anchor: "2027-02-10")
        #expect(february.count == 28)
        #expect(february.first == "2027-02-01" && february.last == "2027-02-28")
        #expect(CalendarDays.bounds(.month, anchor: "2026-10-01") == ("2026-09-28", "2026-11-01"))
    }

    @Test("стрелки: день — на день, месяц — на первое число соседнего месяца")
    func shift() {
        #expect(CalendarDays.shift(.day, "2026-10-31", by: 1) == "2026-11-01")
        #expect(CalendarDays.shift(.month, "2026-10-15", by: 1) == "2026-11-01")
        #expect(CalendarDays.shift(.month, "2026-01-31", by: -1) == "2025-12-01")
    }

    @Test("точки: до трёх несделанных дел этого дня, события из календаря — отдельным цветом")
    func dots() {
        let day = "2026-10-05"
        let list = [
            Todo(id: 1, title: "своё", day: day),
            Todo(id: 2, title: "сделано", day: day, done: true),
            Todo(id: 3, title: "созвон", day: day, time: "10:00", source: .google),
            Todo(id: 4, title: "завтра", day: "2026-10-06"),
            Todo(id: 5, title: "ещё", day: day),
            Todo(id: 6, title: "и ещё", day: day),
        ]
        #expect(CalendarDays.dots(list, day: day) == [false, true, false])
        #expect(CalendarDays.dots(list, day: "2026-10-07") == [])
    }

    @Test("«обновлено…»: не обновлялся — пусто; меньше минуты — «только что»; иначе минуты; время сервера с микросекундами")
    func synced() throws {
        let now = try #require(CalendarDays.parseISO("2026-10-05T09:10:00Z"))
        #expect(CalendarDays.synced(nil, now: now, strings: .ru) == "")
        #expect(CalendarDays.synced("2026-10-05T09:09:30.5+00:00", now: now, strings: .ru) == "обновлено только что")
        #expect(CalendarDays.synced("2026-10-05T09:04:59.123456+00:00", now: now, strings: .ru) == "обновлено 5 мин назад")
        #expect(CalendarDays.synced("2026-10-05T09:05:00Z", now: now, strings: .en) == "updated 5 min ago")
        #expect(CalendarDays.synced("мусор", now: now, strings: .ru) == "")
    }

    @Test("правка дела: уходит только изменённое; день повторяющегося не меняется; место — только у своих")
    func patch() {
        let todo = Todo(id: 1, title: "Купить хлеб", day: "2026-10-05", time: "10:00")
        #expect(TodoEdit(title: "Купить хлеб", day: "2026-10-05", time: "10:00", location: "").patch(for: todo).isEmpty)
        let changed = TodoEdit(title: "Купить батон", day: "2026-10-07", time: nil, location: "Пятёрочка").patch(for: todo)
        #expect(changed == ["title": .string("Купить батон"), "day": .string("2026-10-07"), "time": .null, "location": .string("Пятёрочка")])
        let recurring = Todo(id: 2, title: "Планёрка", day: "2026-10-05", time: "09:00", recurring: true, source: .google)
        #expect(TodoEdit(title: "Планёрка", day: "2026-10-06", time: "09:30").patch(for: recurring) == ["time": .string("09:30")])
        let placed = Todo(id: 3, title: "Врач", day: "2026-10-05", details: TodoDetails(location: "Клиника"))
        #expect(TodoEdit(title: "Врач", day: "2026-10-05", time: nil, location: "").patch(for: placed) == ["location": .string("")])
    }

    @Test("шторка дела: на «Сегодня» переехавшее со вчера открывается сегодняшним; в календаре прошлый день остаётся своим")
    func initialDay() {
        #expect(TodoEdit.initialDay(of: Todo(id: 1, title: "x", day: "2026-10-03"), today: "2026-10-05", carried: true) == "2026-10-05")
        #expect(TodoEdit.initialDay(of: Todo(id: 1, title: "x", day: "2026-10-09"), today: "2026-10-05", carried: true) == "2026-10-09")
        #expect(TodoEdit.initialDay(of: Todo(id: 1, title: "x", day: "2026-10-03", recurring: true), today: "2026-10-05", carried: true) == "2026-10-03")
        // Открыли дело прошлого понедельника во вкладке «Календарь» и поправили букву — оно не уезжает на сегодня.
        let past = Todo(id: 2, title: "Отчёт", day: "2026-09-28", done: true)
        let day = TodoEdit.initialDay(of: past, today: "2026-10-05", carried: false)
        #expect(day == "2026-09-28")
        #expect(TodoEdit(title: "Отчёт!", day: day, time: nil).patch(for: past) == ["title": .string("Отчёт!")])
    }

    @Test("ссылки из событий — чужой ввод: открываем только http(s) с хостом")
    func externalLinks() {
        for good in ["https://meet.google.com/abc-defg-hij", "HTTP://zoom.us/j/9", " https://x.y "] {
            #expect(Links.external(good) != nil, "\(good)")
        }
        for bad in ["javascript:alert(1)", "tg://resolve?domain=x", "file:///etc/passwd", "https://", "mailto:a@b.c", "", "short", "ftp://x.y/z"] {
            #expect(Links.external(bad) == nil, "\(bad)")
        }
        #expect(Links.short(Links.external("https://www.meet.google.com/abc-defg-hij")!) == "meet.google.com/abc-defg-hij")
        #expect(Links.short(Links.external("https://zoom.us/")!) == "zoom.us")
        #expect(Links.short(Links.external("https://example.com/\(String(repeating: "a", count: 60))")!).count == 40)
    }

    @Test("место — в Картах: адрес с запросом; пустое — нет ссылки")
    func mapLinks() {
        #expect(Links.map("  ") == nil)
        #expect(Links.map("Офис, переговорная 3")?.absoluteString == "https://maps.apple.com/?q=%D0%9E%D1%84%D0%B8%D1%81,%20%D0%BF%D0%B5%D1%80%D0%B5%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%B0%D1%8F%203")
        #expect(Links.map("a&b=c")?.query() == "q=a%26b%3Dc")
    }

    @Test("цвет календаря из CSS: #rrggbb; другое — нет цвета")
    func cssColor() {
        #expect(Links.cssColor("#0b8043") == 0x0B8043)
        #expect(Links.cssColor("#FFFFFF") == 0xFFFFFF)
        for bad in ["0b8043", "#0b80", "#0b80431", "#zzzzzz", "", "red"] { #expect(Links.cssColor(bad) == nil, "\(bad)") }
    }

    @Test("возврат из Google: итог и одноразовый код подключения; чужая ссылка, неизвестный итог, испорченный код — нет")
    func googleReturn() {
        let code = String(repeating: "A", count: 43)
        let ok = GoogleReturn(url: URL(string: "lifecommit://calendars?status=ok&pending=\(code)")!)
        #expect(ok == GoogleReturn(status: .ok, pending: code))
        #expect(GoogleReturn(url: URL(string: "lifecommit://calendars?status=expired")!) == GoogleReturn(status: .expired, pending: nil))
        // «ok» без кода подключать нечем — для приложения это сбой.
        #expect(GoogleReturn(url: URL(string: "lifecommit://calendars?status=ok")!) == GoogleReturn(status: .failed, pending: nil))
        #expect(GoogleReturn(url: URL(string: "lifecommit://calendars?status=ok&pending=short")!) == GoogleReturn(status: .failed, pending: nil))
        #expect(GoogleReturn(url: URL(string: "lifecommit://calendars?status=hacked")!) == nil)
        #expect(GoogleReturn(url: URL(string: "lifecommit://tglogin?status=ok")!) == nil)
        #expect(GoogleReturn(url: URL(string: "https://lifecommit.app/calendars?status=ok")!) == nil)
    }
}

@Suite("Календарь: API")
struct CalendarAPITests {
    let base = URL(string: "https://lifecommit.test/api")!

    @Test("подключённые календари читаются в ответе сервера как есть (snake_case, статусы)")
    func decodeAccounts() throws {
        let json = """
        [{"id":3,"provider":"google","login":"dasha@gmail.com","status":"setup","last_sync_at":null,"default_url":null,
          "collections":[{"url":"dasha@gmail.com","name":"dasha@gmail.com","color":"#0b8043","enabled":true,"writable":true},
                         {"url":"ru#holiday","name":"Праздники","color":null,"enabled":false,"writable":false}]},
         {"id":4,"provider":"apple","login":"d@icloud.com","status":"auth_failed","last_sync_at":"2026-10-05T09:00:00.123456+00:00",
          "default_url":"https://caldav.icloud.com/1/calendars/home/","collections":[]}]
        """
        let list = try APIClient.decoder.decode([CalendarAccount].self, from: Data(json.utf8))
        #expect(list.map(\.provider) == [.google, .apple])
        #expect(list[0].status == .setup && list[1].status == .authFailed)
        #expect(list[0].collections[1] == CalendarCollection(url: "ru#holiday", name: "Праздники", enabled: false, writable: false))
        #expect(list[1].defaultUrl == "https://caldav.icloud.com/1/calendars/home/")
    }

    @Test("дни: GET /calendar?from&to; групповые дела пока не читаем")
    func range() async throws {
        let stub = Stub { _ in
            Stub.json(200, ["today": "2026-10-05", "groups": [["day": "2026-10-05"]],
                            "todos": [["id": 1, "title": "Созвон", "day": "2026-10-05", "done": false, "time": "10:00", "duration_min": 30,
                                       "recurring": true, "source": "google", "details": ["link": "https://meet.google.com/abc"]]]])
        }
        let api = APIClient(base: base, session: stub.session)
        let range = try await api.calendar(from: "2026-09-28", to: "2026-11-01")
        #expect(stub.calls.first?.url.absoluteString == "https://lifecommit.test/api/calendar?from=2026-09-28&to=2026-11-01")
        #expect(range.today == "2026-10-05")
        #expect(range.todos.first?.durationMin == 30)
        #expect(range.todos.first?.details?.link == "https://meet.google.com/abc")
    }

    @Test("вход Google: адрес с client=app; открываем только accounts.google.com")
    func googleURL() async throws {
        let good = Stub { _ in Stub.json(200, ["url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=1.2.app.s"]) }
        let url = try await APIClient(base: base, session: good.session).googleSignInURL()
        #expect(url.host() == "accounts.google.com")
        #expect(good.calls.first?.url.absoluteString == "https://lifecommit.test/api/calendars/google/url?client=app")
        for bad in ["https://evil.example/auth", "http://accounts.google.com/auth", "javascript:alert(1)", ""] {
            let stub = Stub { _ in Stub.json(200, ["url": bad]) }
            await #expect(throws: APIError.self, "\(bad)") { try await APIClient(base: base, session: stub.session).googleSignInURL() }
        }
    }

    @Test("подключение Google кодом из возврата: POST /calendars/google/finish {pending} → {account_id, fresh}")
    func finishGoogle() async throws {
        let stub = Stub { _ in Stub.json(200, ["account_id": 7, "fresh": true]) }
        let done = try await APIClient(base: base, session: stub.session).finishGoogle(pending: "code-1")
        #expect(done == GoogleFinished(accountId: 7, fresh: true))
        #expect(stub.calls.first.map { "\($0.method) \($0.url.path())" } == "POST /api/calendars/google/finish")
        #expect(try JSONSerialization.jsonObject(with: stub.calls[0].body) as? [String: String] == ["pending": "code-1"])
    }

    @Test("Apple, выбор календарей, «куда писать», отключить, обновить — пути и тела как в docs/mobile.md")
    func calls() async throws {
        let stub = Stub { _ in Stub.json(200, ["ok": true]) }
        let api = APIClient(base: base, session: stub.session)
        try await api.connectApple(login: "d@icloud.com", password: "abcd-efgh-ijkl-mnop")
        try await api.confirmGoogle(accountId: 3)
        try await api.toggleCollection(accountId: 3, url: "ru#holiday", enabled: true)
        try await api.setDefaultCalendar(accountId: 4, url: "https://caldav.icloud.com/home/")
        try await api.disconnectCalendar(.google)
        try await api.syncCalendars()
        #expect(stub.calls.map { "\($0.method) \($0.url.path())" } == [
            "POST /api/calendars/apple", "POST /api/calendars/3/confirm", "PATCH /api/calendars/3/collections",
            "PATCH /api/calendars/4/default", "DELETE /api/calendars/google", "POST /api/calendars/sync",
        ])
        let apple = try JSONSerialization.jsonObject(with: stub.calls[0].body) as? [String: String]
        #expect(apple == ["login": "d@icloud.com", "password": "abcd-efgh-ijkl-mnop"])
        let toggle = try JSONSerialization.jsonObject(with: stub.calls[2].body) as? [String: Any]
        #expect(toggle?["url"] as? String == "ru#holiday" && toggle?["enabled"] as? Bool == true)
    }

    @Test("Apple не пустил — 401 apple_auth: это ошибка Apple, а не выход из LifeCommit")
    func appleAuthIsNotSignOut() async throws {
        let stub = Stub { _ in Stub.json(401, ["error": "apple_auth"]) }
        do {
            try await APIClient(base: base, session: stub.session).connectApple(login: "d@icloud.com", password: "x")
            Issue.record("ждали ошибку")
        } catch let error as APIError {
            #expect(error.code == "apple_auth")
            #expect(!error.isSignedOut)
        }
    }
}
