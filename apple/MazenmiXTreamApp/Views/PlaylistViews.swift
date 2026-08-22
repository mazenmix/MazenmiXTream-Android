import MazenmiXTreamCore
import SwiftUI

struct AddPlaylistView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @State private var kind: PlaylistKind = .xtream
    @State private var name = ""
    @State private var baseURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var m3uURL = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Playlist type", selection: $kind) {
                        Text("Xtream Codes").tag(PlaylistKind.xtream)
                        Text("M3U / M3U8").tag(PlaylistKind.m3u)
                    }
                    .pickerStyle(.segmented)
                    TextField("Playlist name", text: $name)
                    if kind == .xtream {
                        TextField("Server URL", text: $baseURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        SecureField("Password", text: $password).textInputAutocapitalization(.never)
                    } else {
                        TextField("M3U / M3U8 URL", text: $m3uURL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                } header: {
                    Text("Connection")
                } footer: {
                    Text("Xtream credentials are stored in this device's Keychain and are not included in the catalog cache.")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add Playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Connecting…" : "Add") { save() }.disabled(isSaving || !isValid)
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private var isValid: Bool {
        let validName = !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if kind == .xtream { return validName && validURL(baseURL) && !username.isEmpty && !password.isEmpty }
        return validName && validURL(m3uURL)
    }

    private func validURL(_ value: String) -> Bool {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return ["http", "https"].contains(url.scheme?.lowercased() ?? "") && url.host != nil
    }

    private func save() {
        isSaving = true
        errorMessage = nil
        let source = PlaylistSource(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            kind: kind,
            baseURL: baseURL.trimmingCharacters(in: .whitespacesAndNewlines),
            m3uURL: m3uURL.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let credentials = kind == .xtream ? XtreamCredentials(username: username, password: password) : nil
        Task {
            do {
                try await model.add(source: source, credentials: credentials)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSaving = false
            }
        }
    }
}

struct PlaylistManagerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @Binding var showAddPlaylist: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("Playlists") {
                    ForEach(model.sources) { source in
                        HStack {
                            Button {
                                model.select(source)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(source.name).font(.headline)
                                    Text(source.kind == .xtream ? source.baseURL : source.m3uURL)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            if source.id == model.activeSourceID { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                        }
                        .swipeActions {
                            Button("Delete", role: .destructive) { model.delete(source) }
                        }
                    }
                    Button { dismiss(); showAddPlaylist = true } label: { Label("Add playlist", systemImage: "plus") }
                }
                Section("Privacy & content") {
                    Toggle("Hide adult content", isOn: Binding(get: { model.hideAdult }, set: model.setHideAdult))
                }
                if let info = model.serverInfo {
                    Section("Xtream account") {
                        LabeledContent("Status", value: info.status.isEmpty ? "Unknown" : info.status)
                        LabeledContent("Expiry", value: formattedExpiry(info.expiry))
                        LabeledContent("Connections", value: "\(info.activeConnections) / \(info.maximumConnections)")
                        LabeledContent("Timezone", value: info.timezone.isEmpty ? "Not supplied" : info.timezone)
                    }
                }
                Section {
                    Text("MazenmiXTream stores playlists, favorites and cached catalogs on this device. It includes no analytics or advertising SDK.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Playback engine") {
                    LabeledContent("Standard video", value: "Apple AVPlayer")
                    LabeledContent("Compatibility video", value: "VideoLAN VLCKit")
                    Link("VLCKit source and LGPL license", destination: URL(string: "https://github.com/videolan/vlckit")!)
                }
            }
            .navigationTitle("Manage & Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func formattedExpiry(_ value: String) -> String {
        guard let seconds = TimeInterval(value), seconds > 0 else { return value.isEmpty ? "Not supplied" : value }
        return Date(timeIntervalSince1970: seconds).formatted(date: .abbreviated, time: .omitted)
    }
}
