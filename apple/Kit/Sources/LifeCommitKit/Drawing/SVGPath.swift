// Разбор атрибута d у SVG-пути — значки мини-аппа (src/components/*.tsx) переносятся как есть, теми же числами, а не
// перерисовываются на глаз. Поддержано всё, что встречается в путях SVG: M L H V C S Q T A Z, строчные (относительные)
// и прописные, числа слитно («1.5.5», «-2-3»), дуги переводятся в кривые Безье.
import CoreGraphics
import Foundation

public enum SVGPath {
    public struct ParseError: Error, Equatable, Sendable {
        public let at: Int
    }

    /// CGPath в системе координат viewBox (как в SVG: y вниз).
    public static func cgPath(_ d: String) throws(ParseError) -> CGPath {
        let path = CGMutablePath()
        var t = Tokens(Array(d.utf8))
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var lastQuad: CGPoint?
        var command: UInt8 = 0

        while true {
            t.skipSeparators()
            guard let c = t.peek() else { break }
            if isCommand(c) {
                command = c
                t.index += 1
            } else if command == 0 {
                throw ParseError(at: t.index)
            }
            let rel = command >= UInt8(ascii: "a")
            let base = rel ? current : .zero
            func pt(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: base.x + x, y: base.y + y) }

            switch command | 0x20 {
            case UInt8(ascii: "m"):
                let p = pt(try t.number(), try t.number())
                path.move(to: p)
                current = p
                start = p
                // Пары после M — это L.
                command = rel ? UInt8(ascii: "l") : UInt8(ascii: "L")
                lastControl = nil
                lastQuad = nil
                continue
            case UInt8(ascii: "l"):
                let p = pt(try t.number(), try t.number())
                path.addLine(to: p)
                current = p
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "h"):
                let x = try t.number()
                current = CGPoint(x: rel ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "v"):
                let y = try t.number()
                current = CGPoint(x: current.x, y: rel ? current.y + y : y)
                path.addLine(to: current)
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "c"):
                let c1 = pt(try t.number(), try t.number())
                let c2 = pt(try t.number(), try t.number())
                let p = pt(try t.number(), try t.number())
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
                lastQuad = nil
            case UInt8(ascii: "s"):
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = pt(try t.number(), try t.number())
                let p = pt(try t.number(), try t.number())
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
                lastQuad = nil
            case UInt8(ascii: "q"):
                let q = pt(try t.number(), try t.number())
                let p = pt(try t.number(), try t.number())
                path.addQuadCurve(to: p, control: q)
                current = p
                lastQuad = q
                lastControl = nil
            case UInt8(ascii: "t"):
                let q = lastQuad.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let p = pt(try t.number(), try t.number())
                path.addQuadCurve(to: p, control: q)
                current = p
                lastQuad = q
                lastControl = nil
            case UInt8(ascii: "a"):
                let rx = try t.number(), ry = try t.number(), rotation = try t.number()
                let large = try t.flag(), sweep = try t.flag()
                let p = pt(try t.number(), try t.number())
                addArc(path, from: current, to: p, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                current = p
                lastControl = nil
                lastQuad = nil
            case UInt8(ascii: "z"):
                path.closeSubpath()
                current = start
                lastControl = nil
                lastQuad = nil
                // После Z новая команда обязательна.
                command = 0
            default:
                throw ParseError(at: t.index)
            }
        }
        return path
    }

    static func isCommand(_ c: UInt8) -> Bool {
        "MmLlHhVvCcSsQqTtAaZz".utf8.contains(c)
    }

    /// Дуга эллипса из SVG (конечные точки) → кривые Безье: SVG 1.1, приложение F.6.5.
    static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx rx0: Double, ry ry0: Double, rotation: Double, large: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = abs(rx0), ry = abs(ry0)
        if rx == 0 || ry == 0 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            rx *= lambda.squareRoot()
            ry *= lambda.squareRoot()
        }
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = (max(0, num) / den).squareRoot()
        if large == sweep { coef = -coef }
        let cxp = coef * rx * y1p / ry
        let cyp = -coef * ry * x1p / rx
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
        let step = delta / Double(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        var a = theta1
        func point(_ t: Double) -> (Double, Double) {
            let x = rx * cos(t), y = ry * sin(t)
            return (cosPhi * x - sinPhi * y + cx, sinPhi * x + cosPhi * y + cy)
        }
        func derivative(_ t: Double) -> (Double, Double) {
            let x = -rx * sin(t), y = ry * cos(t)
            return (cosPhi * x - sinPhi * y, sinPhi * x + cosPhi * y)
        }
        for i in 0..<segments {
            let b = a + step
            let (ax, ay) = point(a), (bx, by) = point(b)
            let (dax, day) = derivative(a), (dbx, dby) = derivative(b)
            let c1 = CGPoint(x: ax + k * dax, y: ay + k * day)
            let c2 = CGPoint(x: bx - k * dbx, y: by - k * dby)
            // Последний конец — ровно в целевую точку, без накопленной ошибки.
            let end = i == segments - 1 ? p1 : CGPoint(x: bx, y: by)
            path.addCurve(to: end, control1: c1, control2: c2)
            a = b
        }
    }

    struct Tokens {
        let bytes: [UInt8]
        var index = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        func peek() -> UInt8? { index < bytes.count ? bytes[index] : nil }

        mutating func skipSeparators() {
            while let c = peek(), c == 0x20 || c == 0x2C || c == 0x09 || c == 0x0A || c == 0x0D { index += 1 }
        }

        /// Флаг дуги — одна цифра 0 или 1, может стоять слитно со следующим числом.
        mutating func flag() throws(ParseError) -> Bool {
            skipSeparators()
            guard let c = peek(), c == UInt8(ascii: "0") || c == UInt8(ascii: "1") else { throw ParseError(at: index) }
            index += 1
            return c == UInt8(ascii: "1")
        }

        mutating func number() throws(ParseError) -> Double {
            skipSeparators()
            let begin = index
            if let c = peek(), c == UInt8(ascii: "-") || c == UInt8(ascii: "+") { index += 1 }
            var digits = false, dot = false
            while let c = peek() {
                if c >= UInt8(ascii: "0") && c <= UInt8(ascii: "9") {
                    digits = true
                    index += 1
                } else if c == UInt8(ascii: "."), !dot {
                    dot = true
                    index += 1
                } else {
                    break
                }
            }
            if let c = peek(), digits, c == UInt8(ascii: "e") || c == UInt8(ascii: "E") {
                index += 1
                if let s = peek(), s == UInt8(ascii: "-") || s == UInt8(ascii: "+") { index += 1 }
                while let c = peek(), c >= UInt8(ascii: "0") && c <= UInt8(ascii: "9") { index += 1 }
            }
            guard digits, let value = Double(String(decoding: bytes[begin..<index], as: UTF8.self)) else { throw ParseError(at: begin) }
            return value
        }
    }
}
