import XCTest
@testable import MazenmiXTreamCore

final class ChannelBrowseTests: XCTestCase {
    func testBuildsCountriesFromServerGroups() {
        let items = [
            MediaItem(id: "1", name: "News", group: "UK | NEWS", categoryID: "10", kind: .live),
            MediaItem(id: "2", name: "Sports", group: "IRAQ SPORTS", categoryID: "20", kind: .live),
            MediaItem(id: "3", name: "Cinema", group: "ES | CINE", categoryID: "30", kind: .live)
        ]
        let index = ChannelBrowseIndex(items: items)

        XCTAssertEqual(index.countryIDByChannelID["1"], "united-kingdom")
        XCTAssertEqual(index.countryIDByChannelID["2"], "iraq")
        XCTAssertEqual(index.countryIDByChannelID["3"], "spain")
        XCTAssertEqual(Set(index.countries.map(\.id)), Set(["united-kingdom", "iraq", "spain"]))
    }

    func testDoesNotTreatShortCountryCodeInsideChannelNameAsCountry() {
        let item = MediaItem(id: "1", name: "MUSIC MIX", group: "4K UHD", categoryID: "1", kind: .live)
        let index = ChannelBrowseIndex(items: [item])

        XCTAssertNil(index.countryIDByChannelID[item.id])
        XCTAssertTrue(index.countries.isEmpty)
    }
}
