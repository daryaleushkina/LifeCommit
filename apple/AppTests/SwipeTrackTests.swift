// Свайп строки (SwipeTrack) — как SwipeRow.tsx: короткий открывает кнопки, до конца — срабатывает крайняя, открытую
// строку ведут от того места, где она лежит.
import Testing
@testable import LifeCommit

@Suite("Свайп строки")
struct SwipeTrackTests {
    let width: Double = 400

    @Test("закрытая строка: чуть-чуть — закрывается, короткий — открывает кнопку, до конца — срабатывает действие")
    func fromClosed() {
        var t = SwipeTrack()
        t.move(by: -20, width: width)
        #expect(t.end(width: width) == .closed)
        t.move(by: -60, width: width)
        #expect(t.end(width: width) == .opened)
        #expect(t.offset == -84)
        var u = SwipeTrack()
        u.move(by: -250, width: width)
        #expect(u.end(width: width) == .fired)
    }

    @Test("открытую строку повели дальше влево — остаётся открытой и идёт от открытого места; вправо — закрывается")
    func fromOpen() {
        var t = SwipeTrack()
        t.move(by: -60, width: width)
        _ = t.end(width: width)
        t.move(by: -10, width: width)
        #expect(t.offset == -94)
        #expect(t.end(width: width) == .opened)
        t.move(by: 60, width: width)
        #expect(t.offset == -24)
        #expect(t.end(width: width) == .closed)
    }

    @Test("две кнопки: открывается на ширину двух; дальше ширины строки не уезжает")
    func twoButtons() {
        var t = SwipeTrack(count: 2)
        t.move(by: -100, width: width)
        #expect(t.end(width: width) == .opened)
        #expect(t.offset == -168)
        t.move(by: -600, width: width)
        #expect(t.offset == -400)
        #expect(t.end(width: width) == .fired)
    }
}
