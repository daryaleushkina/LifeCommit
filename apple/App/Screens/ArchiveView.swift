// «Отложенные» — как Archive.tsx: вернуть одним тапом или удалить насовсем (с подтверждением). Пусто — назад.
import LifeCommitKit
import SwiftUI

struct ArchiveView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.strings) private var t
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var message: String?
    @State private var deleting: ArchivedTask?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BackBar().padding(.top, 8)
                PageHead(title: t.archive)
                if let message { ErrorNote(text: message).padding(.top, 12) }
                if !model.today.archived.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(model.today.archived.enumerated()), id: \.element.id) { i, task in
                            if i > 0 { Divider().overlay(palette.line) }
                            HStack(spacing: 10) {
                                Text(task.title).font(.onest(16, .medium)).frame(maxWidth: .infinity, alignment: .leading)
                                Button(t.deleteForever) { deleting = task }
                                    .font(.onest(16, .medium))
                                    .foregroundStyle(palette.muted)
                                    .frame(minWidth: 40, minHeight: 48)
                                Button {
                                    Task { await restore(task) }
                                } label: {
                                    Text(t.restore)
                                        .font(.onest(16, .bold))
                                        .foregroundStyle(palette.text)
                                        .padding(.horizontal, 14)
                                        .frame(minHeight: 48)
                                        // .act.soft мини-аппа: фон экрана, обычный цвет текста.
                                        .background(palette.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                }
                                .buttonStyle(PressScale())
                                .accessibilityLabel("\(t.restore): \(task.title)")
                                .accessibilityIdentifier("archive.restore")
                            }
                            .padding(.leading, 18)
                            .padding(.trailing, 14)
                            .frame(minHeight: 64)
                        }
                    }
                    .glassCard()
                    .padding(.top, 16)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .confirmationDialog(t.deleteForeverConfirm, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button(t.deleteForever, role: .destructive) {
                if let task = deleting { Task { await remove(task) } }
            }
            Button(t.cancel, role: .cancel) {}
        }
    }

    private func restore(_ task: ArchivedTask) async {
        do {
            try await model.restoreTask(id: task.id)
            if model.today.archived.isEmpty { dismiss() }
        } catch {
            message = model.message(for: error)
        }
    }

    private func remove(_ task: ArchivedTask) async {
        do {
            try await model.deleteTaskNow(id: task.id)
            if model.today.archived.isEmpty { dismiss() }
        } catch {
            message = model.message(for: error)
        }
    }
}
