import Foundation

public enum Plural {
    /// Русское склонение по числу: 1 день, 2 дня, 5 дней, 11 дней, 21 день.
    public static func ru(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
        let m10 = abs(n) % 10, m100 = abs(n) % 100
        if m10 == 1 && m100 != 11 { return one }
        if (2...4).contains(m10) && !(12...14).contains(m100) { return few }
        return many
    }

    /// Английское: 1 day, 2 days.
    public static func en(_ n: Int, _ one: String, _ many: String) -> String {
        n == 1 ? one : many
    }
}
