import CoreGraphics
import Testing
@testable import LifeCommitKit

@Suite("Пути SVG")
struct SVGPathTests {
    /// Точки пути по порядку (концы сегментов) — чтобы сравнить с ожидаемым.
    func points(_ path: CGPath) -> [CGPoint] {
        var out: [CGPoint] = []
        path.applyWithBlock { e in
            let el = e.pointee
            switch el.type {
            case .moveToPoint, .addLineToPoint: out.append(el.points[0])
            case .addQuadCurveToPoint: out.append(el.points[1])
            case .addCurveToPoint: out.append(el.points[2])
            case .closeSubpath: break
            @unknown default: break
            }
        }
        return out
    }

    func round(_ ps: [CGPoint]) -> [[Double]] { ps.map { [($0.x * 100).rounded() / 100, ($0.y * 100).rounded() / 100] } }

    @Test("галочка мини-аппа: M5 12.5l4.5 4.5L19 7.5 — относительные и абсолютные")
    func check() throws {
        #expect(round(points(try SVGPath.cgPath("M5 12.5l4.5 4.5L19 7.5"))) == [[5, 12.5], [9.5, 17], [19, 7.5]])
    }

    @Test("H, V, Z и пары после M — это линии")
    func linesAndClose() throws {
        let p = try SVGPath.cgPath("M8 20h32M17 6v8 M1 1 2 2 3 3z")
        #expect(round(points(p)) == [[8, 20], [40, 20], [17, 6], [17, 14], [1, 1], [2, 2], [3, 3]])
    }

    @Test("числа слитно: «1.5.5», «-2-3», экспонента")
    func compactNumbers() throws {
        #expect(round(points(try SVGPath.cgPath("M1.5.5l-2-3L1e1 2E0"))) == [[1.5, 0.5], [-0.5, -2.5], [10, 2]])
    }

    @Test("кривые: C и S (отражённая опорная точка), Q и T")
    func curves() throws {
        let p = try SVGPath.cgPath("M0 0C0 10 10 10 10 0S20-10 20 0Q25 5 30 0T40 0")
        #expect(round(points(p)) == [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]])
    }

    @Test("дуга: полукруг из капли (значок воды) приходит ровно в конечную точку")
    func arc() throws {
        let p = try SVGPath.cgPath("M12 28a12 12 0 0 0 24 0")
        let pts = points(p)
        #expect(round([pts.last!]) == [[36, 28]])
        // Половина окружности радиуса 12 с центром (24, 28) — низ на y = 40.
        let box = p.boundingBoxOfPath
        #expect(abs(box.maxY - 40) < 0.5)
        #expect(abs(box.minX - 12) < 0.01)
    }

    @Test("флаги дуги слитно с числами: a6 6 0 0 1 5 6")
    func arcFlags() throws {
        let p = try SVGPath.cgPath("M18 29a6 6 0 0 0 5 6")
        #expect(round([points(p).last!]) == [[23, 35]])
        let compact = try SVGPath.cgPath("M0 0a5 5 0 105 5")
        #expect(round([points(compact).last!]) == [[5, 5]])
    }

    @Test("мусор — ошибка с местом, а не тихо пустой путь")
    func garbage() {
        #expect(throws: SVGPath.ParseError.self) { try SVGPath.cgPath("12 12") }
        #expect(throws: SVGPath.ParseError.self) { try SVGPath.cgPath("M1 x") }
        #expect(throws: SVGPath.ParseError.self) { try SVGPath.cgPath("M0 0a5 5 0 2 1 5 5") }
    }
}
