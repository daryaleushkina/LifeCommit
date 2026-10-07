// Карта «Месяц · Год» — как HeatCard.tsx и Heatmap.tsx: месяц сеткой (понедельник слева, листается назад на 11
// месяцев), год лентой недель (открывается на текущей неделе, назад — пальцем). Строка периода есть в обоих видах, и
// оба вида лежат друг на друге: высота блока не прыгает при переключении.
import LifeCommitKit
import SwiftUI

struct HeatCard: View {
    let days: [HeatDay]
    let today: String
    @Binding var view: String
    /// Сдвиг от текущего месяца: 0 — этот, -1 — прошлый.
    @Binding var offset: Int
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        let month = Months.shift(Months.of(today), offset)
        let levels = HeatMap.levels(days)
        let year = view == "year"
        let active = HeatMap.activeDays(days, month: year ? nil : month)
        let from = Months.of(HeatMap.yearStart(today))
        let yearLabel = "\(short(from)) \(from.prefix(4)) — \(short(Months.of(today))) \(today.prefix(4))"
        VStack(spacing: 0) {
            Segmented(options: [("month", t.together.month), ("year", t.together.year)], selected: view, label: t.together.month) { view = $0 }
            HStack {
                arrow("‹", label: t.prevMonth, enabled: offset > -HeatMap.monthsBack) { offset -= 1 }
                VStack(spacing: 0) {
                    Text(year ? yearLabel : t.monthYear(month)).font(.onest(15, .semibold))
                    Text(t.together.activeDays(active)).font(.onest(12.5, .medium)).foregroundStyle(palette.muted)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                arrow("›", label: t.nextMonth, enabled: offset < 0) { offset += 1 }
            }
            .frame(minHeight: 40)
            .padding(.top, 6)
            ZStack(alignment: .top) {
                monthGrid(month, levels).opacity(year ? 0 : 1)
                yearMap(levels).opacity(year ? 1 : 0)
            }
            .padding(.top, 8)
            .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 16)
        .glassCard()
    }

    private func short(_ month: String) -> String { t.monthShort(month) }

    /// Стрелка листает месяц; в годе её не видно, но место остаётся (строка не прыгает).
    private func arrow(_ symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(symbol).font(.onest(22)).foregroundStyle(palette.muted).frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(view == "year" ? 0 : enabled ? 1 : 0.35)
        .allowsHitTesting(view != "year")
        .accessibilityHidden(view == "year")
        .accessibilityLabel(label)
    }

    /// Месяц: семь колонок по 28 точек, разнесённых по ширине (justify-content: space-between), место — под шесть недель.
    private func monthGrid(_ month: String, _ levels: [String: Int]) -> some View {
        let cells = Months.cells(month)
        let all: [String?] = Array(repeating: nil, count: cells.lead) + cells.days.map(Optional.some)
        let rows = stride(from: 0, to: all.count, by: 7).map { Array(all[$0..<min($0 + 7, all.count)]) }
        return VStack(spacing: 7) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { i in
                        if i > 0 { Spacer(minLength: 0) }
                        cell(i < row.count ? row[i] : nil, levels, size: 28, radius: 8, todayRing: true)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 6 * 28 + 5 * 7, alignment: .top)
    }

    private func yearMap(_ levels: [String: Int]) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 4) {
                    ForEach(HeatMap.weeks(today), id: \.monday) { week in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(week.month.map(short) ?? " ").font(.onest(11)).foregroundStyle(palette.muted).lineLimit(1).fixedSize().frame(width: 22, height: 16, alignment: .leading)
                            ForEach(0..<7, id: \.self) { d in
                                cell(Days.add(week.monday, d), levels, size: 22, radius: 6, todayRing: false)
                            }
                        }
                        .id(week.monday)
                    }
                }
            }
            .onAppear { proxy.scrollTo(HeatMap.weeks(today).last?.monday, anchor: .trailing) }
        }
    }

    @ViewBuilder private func cell(_ day: String?, _ levels: [String: Int], size: CGFloat, radius: CGFloat, todayRing: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if let day {
            if let level = HeatMap.cell(day, levels: levels, today: today) {
                shape.fill(palette.heat[level])
                    .frame(width: size, height: size)
                    .overlay {
                        if day == today { shape.strokeBorder(palette.text, lineWidth: todayRing ? 1.5 : 2).padding(todayRing ? -2.5 : 0) }
                    }
            } else {
                shape.strokeBorder(palette.line, lineWidth: 1).frame(width: size, height: size)
            }
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }
}
