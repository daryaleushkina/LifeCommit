// Общие кусочки «Вместе» — как groupUi.tsx и GroupBlocks.tsx: аватарки (фото Telegram или буква на цветном круге),
// значок группы, строка группового дела (галочка, если моё; кто делает и кто сделал; цель с полоской и «+ Положить»),
// удаление общего дела свайпом с вопросом «только сегодня или у всех», блок группы на «Сегодня» и в дне календаря.
import LifeCommitKit
import SwiftUI

/// Аватарка: фото (только https) или первая буква на цвете, который у человека везде один.
struct AvatarView: View {
    let member: GroupMember
    var size: CGFloat = 28

    var body: some View {
        let tint = Tints.avatar(member.id)
        Group {
            if let url = Tints.photoURL(member.photo) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        letter(tint)
                    }
                }
            } else {
                letter(tint)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private func letter(_ tint: (bg: UInt32, ink: UInt32)) -> some View {
        Text(Tints.initial(member.name))
            .font(.onest(round(size * 0.42), .bold))
            .foregroundStyle(Color(hex: tint.ink))
            .frame(width: size, height: size)
            .background(Color(hex: tint.bg))
    }
}

/// Аватарки внахлёст (до четырёх и «+N»), с каймой цвета фона.
struct AvatarStack: View {
    let members: [GroupMember]
    var size: CGFloat = 24
    var max = 4
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: -5) {
            ForEach(members.prefix(max)) { m in
                AvatarView(member: m, size: size).overlay(Circle().stroke(palette.bg, lineWidth: 2))
            }
            if members.count > max {
                Text("+\(members.count - max)")
                    .font(.onest(round(size * 0.4), .bold))
                    .foregroundStyle(palette.muted)
                    .frame(width: size, height: size)
                    .background(palette.heat[0], in: Circle())
                    .overlay(Circle().stroke(palette.bg, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Значок группы: первая буква, цвет — по id группы (тип группы не выбирают).
struct GroupBadge: View {
    let id: Int
    let title: String
    var size: CGFloat = 48

    var body: some View {
        let tint = Tints.group(id)
        Text(Tints.initial(title))
            .font(.onest(round(size * 0.42), .bold))
            .foregroundStyle(Color(hex: tint.ink))
            .frame(width: size, height: size)
            .background(Color(hex: tint.bg), in: RoundedRectangle(cornerRadius: round(size * 0.33), style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Полоска прогресса (.goal-bar): 8 точек высотой, заливка — акцентом.
struct GoalBar: View {
    let value: Double
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.text.opacity(0.09))
                Capsule().fill(palette.accent).frame(width: geo.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 8)
        .accessibilityHidden(true)
    }
}

/// Плашка под делом (.badge): серая, моя, другому, каждому.
struct GroupBadgeLabel: View {
    let badge: GroupLogic.Badge
    @Environment(\.palette) private var palette

    var body: some View {
        let (text, fg, bg): (String, Color, AnyShapeStyle) = switch badge {
        case .gray(let s): (s, palette.muted, AnyShapeStyle(palette.text.opacity(0.07)))
        case .mine(let s): (s, palette.accentText, AnyShapeStyle(palette.accent))
        case .other(let s): (s, palette.amberInk, AnyShapeStyle(palette.amber.opacity(0.2)))
        case .all(let s): (s, palette.outsideInk, AnyShapeStyle(palette.outside.opacity(0.16)))
        }
        Text(text)
            .font(.onest(12, .semibold, relativeTo: .caption))
            .foregroundStyle(fg)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(minHeight: 22)
            .background(bg, in: Capsule())
    }
}

/// Строка группового дела. onToggle — галочка (если отметить можно); onOpen — нажали на строку; onPut — «+ Положить»
/// у цели; swipe — смахнуть, чтобы удалить (группа и день строки).
struct GroupItemRow: View {
    let item: GroupDayItem
    let members: [GroupMember]
    var onToggle: (() -> Void)?
    var onOpen: (() -> Void)?
    var onPut: (() -> Void)?
    var swipe: (groupId: Int, day: String)?
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @State private var askRemoval = false

    var body: some View {
        SwipeRow(actions: swipeActions) {
            if item.mode == .goal { goal } else { regular }
        }
        .confirmationDialog(t.together.sharedHint, isPresented: $askRemoval, titleVisibility: .visible) {
            if let swipe {
                Button(t.together.onlyToday) { model.together.removeItem(groupId: swipe.groupId, item, skipDay: swipe.day) }
                Button(t.together.forAll, role: .destructive) { model.together.removeItem(groupId: swipe.groupId, item, skipDay: nil) }
            }
            Button(t.cancel, role: .cancel) {}
        }
    }

    /// Разовое — сразу с «Вернуть»; повторяющееся — спросить, убрать только в этот день или у всех.
    private var swipeActions: [SwipeAction] {
        guard let swipe else { return [] }
        return [SwipeAction(label: t.swipe.remove) {
            if GroupLogic.asksRemoval(item) {
                askRemoval = true
            } else {
                model.together.removeItem(groupId: swipe.groupId, item, skipDay: nil)
            }
        }]
    }

    private var me: Int { model.user?.id ?? 0 }

    private var goal: some View {
        let total = item.total ?? 0
        let target = item.target ?? 1
        return HStack(spacing: 12) {
            Button { onOpen?() } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.onest(16)).foregroundStyle(palette.text)
                    Text(t.gr.goalOf(GroupLogic.goalNumber(total, unit: item.unit, strings: t), GroupLogic.goalNumber(target, unit: item.unit, strings: t)))
                        .font(.onest(13)).foregroundStyle(palette.muted)
                    GoalBar(value: target > 0 ? total / target : 0).padding(.top, 6)
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("gi-\(item.title)")
            if let onPut {
                Button(action: onPut) {
                    Text("+ \(t.gr.put)")
                        .font(.onest(14, .bold))
                        .foregroundStyle(palette.accentSoftText)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(PressScale())
                .accessibilityIdentifier("put-\(item.title)")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .frame(minHeight: 52)
    }

    private var regular: some View {
        let badge = GroupLogic.badge(item, members: members, me: me, strings: t)
        let doneLine = GroupLogic.doneLine(item, members: members, me: me, strings: t)
        return HStack(spacing: 0) {
            check
            Button { onOpen?() } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.onest(16))
                        .foregroundStyle(item.done ? palette.muted : palette.text)
                        .strikethrough(item.done, color: palette.muted.opacity(0.6))
                    if item.time != nil || badge != nil || doneLine != nil {
                        FlowRow(spacing: 6) {
                            if let time = item.time { Text(time).font(.onest(13, .bold)).foregroundStyle(palette.accent) }
                            if let badge { GroupBadgeLabel(badge: badge) }
                            if let doneLine { Text(doneLine).font(.onest(13)).foregroundStyle(palette.muted) }
                        }
                    }
                }
                .padding(.vertical, 8)
                .padding(.leading, 4)
                .padding(.trailing, 14)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("gi-\(item.title)")
        }
        .padding(.leading, 8)
        .opacity(item.done ? 0.85 : 1)
    }

    /// Мероприятие — синей полоской без галочки; моё — кружок-галочка; чужое — бледный кружок (сделанное — залит).
    @ViewBuilder private var check: some View {
        if item.mode == .event {
            RoundedRectangle(cornerRadius: 2).fill(palette.outside).frame(width: 4, height: 22).frame(width: 48, height: 48)
        } else if item.canMark, let onToggle {
            Button(action: onToggle) { circle(filled: item.done ? palette.accent : nil, stroke: palette.muted) }
                .buttonStyle(PressScale())
                .accessibilityLabel(item.done ? t.todo.uncheck(item.title) : t.todo.check(item.title))
                .accessibilityAddTraits(item.done ? .isSelected : [])
        } else {
            circle(filled: item.done ? palette.accent.opacity(0.55) : nil, stroke: palette.line)
                .accessibilityHidden(true)
        }
    }

    private func circle(filled: Color?, stroke: Color) -> some View {
        ZStack {
            Circle().strokeBorder(stroke, lineWidth: filled == nil ? 2 : 0)
                .background(Circle().fill(filled ?? .clear))
                .frame(width: 24, height: 24)
            StrokeGlyph(d: Glyph.check, lineWidth: 3)
                .frame(width: 16, height: 16)
                .foregroundStyle(filled == nil ? .clear : palette.accentText)
        }
        .frame(width: 48, height: 48)
        .contentShape(Rectangle())
        .animation(.easeOut(duration: 0.2), value: item.done)
    }
}

/// Блок группы (GroupBlocks.tsx): заголовок ведёт в группу, ниже — дела карточкой. На «Сегодня» — счётчик «1 из 3».
struct GroupBlockView: View {
    let groupId: Int
    let title: String
    let members: [GroupMember]
    let items: [GroupDayItem]
    var progress: String?
    /// Отметить можно (сегодня и прошлые дни календаря); будущее — только посмотреть.
    var canMark = true
    /// День строк — «убрать только в этот день» у повторяющегося.
    let day: String
    let onToggle: (GroupDayItem) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette

    var body: some View {
        let shown = items.filter { !TogetherModel.isRemoved(model, groupId, $0.id, day: day) }
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Button { model.path.append(.group(groupId)) } label: {
                    HStack(spacing: 10) {
                        Text(title).font(.onest(18, .bold)).foregroundStyle(palette.text).lineLimit(1)
                        AvatarStack(members: members, size: 22)
                        Spacer(minLength: 0)
                        if let progress { Text(progress).font(.onest(13)).foregroundStyle(palette.muted) }
                        StrokeGlyph(d: Glyph.chevron, lineWidth: 2.2).frame(width: 18, height: 18).foregroundStyle(palette.muted)
                    }
                    .padding(.horizontal, 4)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("group-block-\(title)")

                VStack(spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, it in
                        if index > 0 { Divider().overlay(palette.line) }
                        GroupItemRow(
                            item: canMark ? it : Self.readOnly(it), members: members,
                            onToggle: { onToggle(it) }, onOpen: { model.path.append(.group(groupId)) },
                            onPut: { model.path.append(.group(groupId)) }, swipe: (groupId, day)
                        )
                    }
                }
                .glassCard()
            }
            .padding(.top, 22)
        }
    }

    static func readOnly(_ it: GroupDayItem) -> GroupDayItem {
        var x = it
        x.canMark = false
        return x
    }
}

/// Подсказка после действия — поверх, над нижней панелью (.toast); тап убирает, сама уходит через 3,5 секунды.
struct NoteToast: View {
    let text: String
    let onClose: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Text(text)
            .font(.onest(14, .medium))
            .foregroundStyle(palette.bg)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(palette.text.opacity(0.88), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
            .padding(.horizontal, 20)
            .onTapGesture(perform: onClose)
            .task(id: text) {
                try? await Task.sleep(for: .seconds(3.5))
                guard !Task.isCancelled else { return }
                onClose()
            }
            .accessibilityAddTraits(.isStaticText)
            .accessibilityIdentifier("note")
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
