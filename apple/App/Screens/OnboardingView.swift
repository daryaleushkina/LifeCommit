// «Чего я хочу?» — первый экран и первый шаг новой привычки (Onboarding.tsx): три намерения с цветными плитками,
// тап открывает редактор уже нужного вида. «Пропустить» — только на первом экране.
import LifeCommitKit
import SwiftUI

struct OnboardingView: View {
    let onSkip: (() -> Void)?
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if onSkip == nil { BackBar().padding(.top, 8) }
                PageHead(title: t.onboardingTitle, subtitle: t.onboardingHint)
                VStack(spacing: 12) {
                    ForEach([TaskKind.check, .count, .abstain], id: \.self) { kind in
                        Button {
                            model.path.append(.newTask(kind))
                        } label: {
                            HStack(spacing: 16) {
                                KindTile(kind: kind, size: .lg)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(t.intents[kind]?.title ?? "").font(.onest(17, .semibold))
                                    Text(t.intents[kind]?.examples ?? "").font(.onest(14)).foregroundStyle(palette.muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .multilineTextAlignment(.leading)
                                StrokeGlyph(d: "M9.5 6l6 6-6 6").frame(width: 20, height: 20).foregroundStyle(palette.muted)
                            }
                            .padding(16)
                            .frame(minHeight: 88)
                            .glassCard()
                        }
                        .buttonStyle(PressScale())
                        .accessibilityIdentifier("intent-\(kind.rawValue)")
                    }
                }
                .padding(.top, 28)
                if let onSkip {
                    Button(t.onboardingSkip, action: onSkip)
                        .font(.onest(15))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .padding(.top, 20)
                        .accessibilityIdentifier("skip")
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
    }
}
