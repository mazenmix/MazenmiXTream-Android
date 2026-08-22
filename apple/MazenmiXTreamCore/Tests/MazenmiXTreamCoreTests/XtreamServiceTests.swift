import XCTest
@testable import MazenmiXTreamCore

final class XtreamServiceTests: XCTestCase {
    func testEndpointEncodesCredentialsAndAction() throws {
        let source = PlaylistSource(name: "Test", kind: .xtream, baseURL: "https://iptv.example:8443/")
        let credentials = XtreamCredentials(username: "user+name", password: "p@ss word")
        let url = try XtreamService().endpointURL(
            source: source,
            credentials: credentials,
            action: "get_short_epg",
            extra: ["stream_id": "44", "limit": "2"]
        )
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let values = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(components.path, "/player_api.php")
        XCTAssertEqual(values["username"], "user+name")
        XCTAssertEqual(values["password"], "p@ss word")
        XCTAssertEqual(values["action"], "get_short_epg")
        XCTAssertEqual(values["stream_id"], "44")
    }

    func testAdultFilterSupportsArabicAndEnglish() {
        XCTAssertTrue(ContentFilter.isAdult("Adults 18+"))
        XCTAssertTrue(ContentFilter.isAdult("قنوات للكبار"))
        XCTAssertFalse(ContentFilter.isAdult("Kids and Family"))
    }

    func testBase64ProgramTitleDecoding() {
        XCTAssertEqual("TXkgUHJvZ3JhbQ==".decodedBase64IfNeeded, "My Program")
        XCTAssertEqual("Normal title".decodedBase64IfNeeded, "Normal title")
    }
}
