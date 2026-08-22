import XCTest
@testable import MazenmiXTreamCore

final class PlaybackPlannerTests: XCTestCase {
    private let credentials = XtreamCredentials(username: "user name", password: "p/a?#")
    private let server = ServerAccountInfo(
        streamBaseURL: "https://example.com:8443",
        allowedOutputFormats: ["ts"]
    )

    func testLivePrefersGeneratedHLSWhenServerOnlyReportsTransportStream() {
        let urls = XtreamPlaybackPlanner.urls(
            kind: .live,
            streamID: "42",
            explicitExtension: "ts",
            direct: "",
            credentials: credentials,
            server: server
        )

        XCTAssertTrue(urls.first?.hasSuffix("/42.m3u8") == true)
        XCTAssertTrue(urls.contains(where: { $0.hasSuffix("/42.ts") }))
    }

    func testLiveKeepsDirectHLSFirstAndRemovesDuplicates() {
        let direct = "https://cdn.example.com/channel.m3u8"
        let urls = XtreamPlaybackPlanner.urls(
            kind: .live,
            streamID: "9",
            explicitExtension: "m3u8",
            direct: direct,
            credentials: credentials,
            server: ServerAccountInfo(streamBaseURL: "https://example.com", allowedOutputFormats: ["m3u8", "ts", "ts"])
        )

        XCTAssertEqual(urls.first, direct)
        XCTAssertEqual(Set(urls).count, urls.count)
    }

    func testCredentialsAreEncodedAsPathComponents() {
        let urls = XtreamPlaybackPlanner.urls(
            kind: .live,
            streamID: "42",
            explicitExtension: "ts",
            direct: "",
            credentials: credentials,
            server: server
        )

        XCTAssertTrue(urls[0].contains("user%20name/p%2Fa%3F%23/42.m3u8"))
    }
}
