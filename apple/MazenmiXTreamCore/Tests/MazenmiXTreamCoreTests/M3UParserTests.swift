import XCTest
@testable import MazenmiXTreamCore

final class M3UParserTests: XCTestCase {
    func testParsesLiveMovieRelativeURLAndHeaders() throws {
        let playlist = """
        #EXTM3U
        #EXTINF:-1 tvg-id="news" tvg-logo="https://img.example/news.png" group-title="News",MX News
        #EXTVLCOPT:http-user-agent=MazenTest/1.0
        live/news.m3u8
        #EXTINF:-1 group-title="Movies",Example Film
        https://cdn.example/movie.mp4
        """

        let result = try M3UParser().parse(playlist, sourceURL: URL(string: "https://iptv.example/list/main.m3u")!)
        XCTAssertEqual(result.catalog.live.count, 1)
        XCTAssertEqual(result.catalog.movies.count, 1)
        XCTAssertEqual(result.catalog.live[0].name, "MX News")
        XCTAssertEqual(result.catalog.live[0].playbackURLs, ["https://iptv.example/list/live/news.m3u8"])
        XCTAssertEqual(result.catalog.live[0].headers["User-Agent"], "MazenTest/1.0")
        XCTAssertEqual(result.catalog.movieCategories, [MediaCategory(id: "Movies", name: "Movies")])
    }

    func testTreatsStandaloneHLSAsDirectLiveStream() throws {
        let result = try M3UParser().parse("#EXTM3U\n#EXT-X-VERSION:3\n", sourceURL: URL(string: "https://cdn.example/live.m3u8")!)
        XCTAssertEqual(result.catalog.live.first?.playbackURLs.first, "https://cdn.example/live.m3u8")
    }

    func testRejectsNonM3UResponse() {
        XCTAssertThrowsError(try M3UParser().parse("login failed", sourceURL: URL(string: "https://example.com")!))
    }
}
