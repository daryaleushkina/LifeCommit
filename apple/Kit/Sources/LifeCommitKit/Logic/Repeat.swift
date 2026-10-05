// Как часто привычку делают — одной строкой: «Каждый день», «Пн, ср, пт», «3 раза в неделю» (src/repeat.ts).
import Foundation

public enum Repeat {
    static let allDays = 127

    public static func label(_ strings: Strings, schedule: Schedule, weekdays: Int, perWeek: Int?) -> String {
        switch schedule {
        case .perWeek:
            return strings.perWeek(perWeek ?? 3)
        case .weekdays where weekdays != allDays:
            let names = strings.weekdaysShort.enumerated().filter { weekdays & (1 << $0.offset) != 0 }.map(\.element)
            let joined = names.joined(separator: ", ").lowercased(with: strings.locale)
            return joined.prefix(1).uppercased(with: strings.locale) + joined.dropFirst()
        default:
            return strings.schedules[.daily] ?? ""
        }
    }
}
