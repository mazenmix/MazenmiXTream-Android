import Foundation

actor CatalogCache {
    private let folder: URL

    init() {
        let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        folder = applicationSupport.appendingPathComponent("MazenmiXTream/Catalogs", isDirectory: true)
    }

    func load(id: UUID) -> CatalogResponse? {
        let url = folder.appendingPathComponent("\(id.uuidString).json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CatalogResponse.self, from: data)
    }

    func save(_ value: CatalogResponse, id: UUID) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(value)
        try data.write(to: folder.appendingPathComponent("\(id.uuidString).json"), options: .atomic)
    }

    func delete(id: UUID) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("\(id.uuidString).json"))
    }
}
