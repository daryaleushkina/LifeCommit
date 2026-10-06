// Палитра «Мягкий» — те же цвета, что токены src/styles/app.css (светлая :root, тёмная [data-color-scheme='dark']).
// Поменяли токен в мини-аппе — меняем здесь (CLAUDE.md «Платформы»: вид нативных — копия мини-аппа).
import LifeCommitKit
import SwiftUI

struct Palette: Sendable {
    let bg: Color
    let surface: Color
    let text: Color
    let muted: Color
    let line: Color
    let accent: Color
    let accentText: Color
    let accentSoft: Color
    let accentSoftText: Color
    let accentLabel: Color
    let warn: Color
    let warnSoft: Color
    let warnText: Color
    let danger: Color
    let dangerText: Color
    /// Спокойная кнопка под строкой («Скрыть»): --neutral-pill.
    let neutralPill: Color
    let neutralPillText: Color
    let outside: Color
    /// Текст на светло-синем (.badge.blue): --outside-ink.
    let outsideInk: Color
    /// Янтарный (.badge.amber — дело другому): --amber, --amber-ink.
    let amber: Color
    let amberInk: Color
    /// Чат Telegram в настройках группы: --telegram-ink.
    let telegramInk: Color
    let heat: [Color]
    /// Стекло: заливка панели и обводка, тень.
    let glass: Color
    let glassEdge: Color
    let glassShadow: Color
    let glassShadowRadius: CGFloat
    let glassShadowY: CGFloat
    /// Системный материал в тёмной теме серее, чем размытие мини-аппа: притемняем его цветом фона.
    let glassTint: Color
    /// Цветные пятна фона (--glow): цвет, центр, радиусы (доли ширины и высоты).
    let glow: [Glow]
    let isDark: Bool

    struct Glow: Sendable {
        let color: Color
        let center: UnitPoint
        let rx: CGFloat
        let ry: CGFloat
    }

    struct Kind: Sendable {
        let bg: Color
        let ink: Color
        let mid: Color
    }

    let kinds: [TaskKind: Kind]

    func kind(_ k: TaskKind) -> Kind { kinds[k]! }

    static let light = Palette(
        bg: Color(hex: 0xF6F4EE),
        surface: .white,
        text: Color(hex: 0x1F2A1F),
        muted: Color(hex: 0x5E665B),
        line: Color(hex: 0xE3E0D6),
        accent: Color(hex: 0x237A46),
        accentText: .white,
        accentSoft: Color(hex: 0xE6F2E9),
        accentSoftText: Color(hex: 0x1B6139),
        accentLabel: Color(hex: 0x237A46),
        warn: Color(hex: 0xB4532A),
        warnSoft: Color(hex: 0xF8E4DA),
        warnText: .white,
        danger: Color(hex: 0xC4413A),
        dangerText: .white,
        neutralPill: Color(hex: 0x6B7368),
        neutralPillText: .white,
        outside: Color(hex: 0x4470CC),
        outsideInk: Color(hex: 0x2B4579),
        amber: Color(hex: 0xD9A441),
        amberInk: Color(hex: 0x6E4F0E),
        telegramInk: Color(hex: 0x2A8BC8),
        heat: [Color(hex: 0xE4E8DF), Color(hex: 0xB8E0C4), Color(hex: 0x7CCB96), Color(hex: 0x3FA968), Color(hex: 0x237A46)],
        glass: Color.white.opacity(0.58),
        glassEdge: Color.white.opacity(0.75),
        glassShadow: Color(hex: 0x1F2A1F).opacity(0.07),
        glassShadowRadius: 12,
        glassShadowY: 8,
        glassTint: .clear,
        glow: [
            Glow(color: Color(red: 178 / 255, green: 228 / 255, blue: 196 / 255).opacity(0.7), center: UnitPoint(x: 0, y: 0.18), rx: 0.6, ry: 0.34),
            Glow(color: Color(red: 243 / 255, green: 226 / 255, blue: 184 / 255).opacity(0.7), center: UnitPoint(x: 1, y: 0.40), rx: 0.6, ry: 0.32),
            Glow(color: Color(red: 246 / 255, green: 211 / 255, blue: 194 / 255).opacity(0.65), center: UnitPoint(x: 0, y: 0.70), rx: 0.6, ry: 0.32),
            Glow(color: Color(red: 190 / 255, green: 232 / 255, blue: 206 / 255).opacity(0.7), center: UnitPoint(x: 1, y: 0.88), rx: 0.7, ry: 0.34),
        ],
        isDark: false,
        kinds: [
            .check: Kind(bg: Color(hex: 0xE6F2E9), ink: Color(hex: 0x237A46), mid: Color(hex: 0xBFE3CB)),
            .count: Kind(bg: Color(hex: 0xF5EBD3), ink: Color(hex: 0x8A6412), mid: Color(hex: 0xE9D29B)),
            .abstain: Kind(bg: Color(hex: 0xF8E4DA), ink: Color(hex: 0xB4532A), mid: Color(hex: 0xEFC3AE)),
        ]
    )

    static let dark = Palette(
        bg: Color(hex: 0x0F1511),
        surface: Color(hex: 0x1B211C),
        text: Color(hex: 0xE8EEE6),
        muted: Color(hex: 0xA3AD9F),
        line: Color(hex: 0x2A322B),
        accent: Color(hex: 0x3FA968),
        accentText: Color(hex: 0x0E1A12),
        accentSoft: Color(hex: 0x1E3325),
        accentSoftText: Color(hex: 0x8FD6A6),
        accentLabel: Color(hex: 0x4CB878),
        warn: Color(hex: 0xE38A62),
        warnSoft: Color(hex: 0x3A241B),
        warnText: Color(hex: 0x1B110C),
        danger: Color(hex: 0xEC7A6F),
        dangerText: Color(hex: 0x1F0D0B),
        neutralPill: Color(hex: 0xA3AD9F),
        neutralPillText: Color(hex: 0x0F1511),
        outside: Color(hex: 0x7F9FE3),
        outsideInk: Color(hex: 0xA9C1F0),
        amber: Color(hex: 0xD9A441),
        amberInk: Color(hex: 0xE8C98A),
        telegramInk: Color(hex: 0x2A8BC8),
        heat: [Color.white.opacity(0.09), Color(hex: 0x1E4A2E), Color(hex: 0x2B7143), Color(hex: 0x3FA968), Color(hex: 0x7CCB96)],
        glass: Color.white.opacity(0.07),
        glassEdge: Color.white.opacity(0.07),
        glassShadow: Color.black.opacity(0.25),
        glassShadowRadius: 15,
        glassShadowY: 10,
        glassTint: Color(hex: 0x0F1511).opacity(0.55),
        glow: [
            Glow(color: Color(red: 31 / 255, green: 107 / 255, blue: 63 / 255).opacity(0.55), center: UnitPoint(x: 0, y: 0.16), rx: 0.7, ry: 0.36),
            Glow(color: Color(red: 90 / 255, green: 74 / 255, blue: 18 / 255).opacity(0.5), center: UnitPoint(x: 1, y: 0.42), rx: 0.6, ry: 0.32),
            Glow(color: Color(red: 107 / 255, green: 46 / 255, blue: 24 / 255).opacity(0.5), center: UnitPoint(x: 0, y: 0.72), rx: 0.6, ry: 0.32),
            Glow(color: Color(red: 27 / 255, green: 92 / 255, blue: 56 / 255).opacity(0.55), center: UnitPoint(x: 1, y: 0.88), rx: 0.7, ry: 0.34),
        ],
        isDark: true,
        kinds: [
            .check: Kind(bg: Color(hex: 0x1E3325), ink: Color(hex: 0x8FD6A6), mid: Color(hex: 0x2B5A3A)),
            .count: Kind(bg: Color(hex: 0x3A3116), ink: Color(hex: 0xE2C36B), mid: Color(hex: 0x6B5720)),
            .abstain: Kind(bg: Color(hex: 0x3A241B), ink: Color(hex: 0xE38A62), mid: Color(hex: 0x6E3F2C)),
        ]
    )

    static func of(_ scheme: ColorScheme) -> Palette { scheme == .dark ? .dark : .light }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.light
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

/// Тема: пока человек не выбрал — как в системе; выбор хранится на устройстве (как localStorage `lc-theme`).
enum ThemeChoice: String {
    case light, dark

    static let key = "lc-theme"

    static var saved: ThemeChoice? {
        UserDefaults.standard.string(forKey: key).flatMap(ThemeChoice.init(rawValue:))
    }

    var scheme: ColorScheme { self == .dark ? .dark : .light }
}
