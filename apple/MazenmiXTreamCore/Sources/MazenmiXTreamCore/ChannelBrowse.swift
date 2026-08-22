import Foundation

public struct ChannelCountry: Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var flag: String
    public var channelCount: Int

    public init(id: String, name: String, flag: String, channelCount: Int) {
        self.id = id
        self.name = name
        self.flag = flag
        self.channelCount = channelCount
    }
}

public struct ChannelBrowseIndex: Sendable {
    public var countries: [ChannelCountry]
    public var countryIDByChannelID: [String: String]

    public init(items: [MediaItem]) {
        var mapping: [String: String] = [:]
        var counts: [String: Int] = [:]

        for item in items {
            guard let definition = Self.country(for: item) else { continue }
            mapping[item.id] = definition.id
            counts[definition.id, default: 0] += 1
        }

        countryIDByChannelID = mapping
        countries = Self.definitions.compactMap { definition in
            guard let count = counts[definition.id], count > 0 else { return nil }
            return ChannelCountry(id: definition.id, name: definition.name, flag: definition.flag, channelCount: count)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func country(for item: MediaItem) -> CountryDefinition? {
        match(item.group, allowShortCodes: true) ?? match(item.name, allowShortCodes: false)
    }

    private static func match(_ value: String, allowShortCodes: Bool) -> CountryDefinition? {
        let searchable = normalized(value)
        return definitions.first { definition in
            definition.aliases.contains { alias in
                let cleanAlias = normalized(alias).trimmingCharacters(in: .whitespaces)
                guard allowShortCodes || cleanAlias.count > 2 else { return false }
                return searchable.contains(" \(cleanAlias) ")
            }
        }
    }

    private static func normalized(_ value: String) -> String {
        let folded = value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let clean = folded.replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
        return " \(clean.split(separator: " ").joined(separator: " ")) "
    }

    private struct CountryDefinition: Sendable {
        let id: String
        let name: String
        let flag: String
        let aliases: [String]
    }

    private static let definitions: [CountryDefinition] = [
        .init(id: "iraq", name: "Iraq", flag: "🇮🇶", aliases: ["iraq", "iraqi", "عراق", "العراق", "عراقي"]),
        .init(id: "kurdistan", name: "Kurdistan", flag: "☀️", aliases: ["kurdistan", "kurdish", "كوردستان", "كردستان", "كوردي"]),
        .init(id: "saudi-arabia", name: "Saudi Arabia", flag: "🇸🇦", aliases: ["saudi", "ksa", "السعودية", "سعودي"]),
        .init(id: "uae", name: "United Arab Emirates", flag: "🇦🇪", aliases: ["uae", "emirates", "dubai", "الامارات", "الإمارات", "دبي"]),
        .init(id: "kuwait", name: "Kuwait", flag: "🇰🇼", aliases: ["kuwait", "الكويت", "كويتي"]),
        .init(id: "qatar", name: "Qatar", flag: "🇶🇦", aliases: ["qatar", "قطر", "قطري"]),
        .init(id: "bahrain", name: "Bahrain", flag: "🇧🇭", aliases: ["bahrain", "البحرين", "بحريني"]),
        .init(id: "oman", name: "Oman", flag: "🇴🇲", aliases: ["oman", "عمان", "عماني"]),
        .init(id: "jordan", name: "Jordan", flag: "🇯🇴", aliases: ["jordan", "الاردن", "الأردن", "اردني"]),
        .init(id: "lebanon", name: "Lebanon", flag: "🇱🇧", aliases: ["lebanon", "لبنان", "لبناني"]),
        .init(id: "egypt", name: "Egypt", flag: "🇪🇬", aliases: ["egypt", "مصر", "مصري"]),
        .init(id: "morocco", name: "Morocco", flag: "🇲🇦", aliases: ["morocco", "maroc", "المغرب", "مغربي"]),
        .init(id: "algeria", name: "Algeria", flag: "🇩🇿", aliases: ["algeria", "الجزائر", "جزائري"]),
        .init(id: "tunisia", name: "Tunisia", flag: "🇹🇳", aliases: ["tunisia", "تونس", "تونسي"]),
        .init(id: "palestine", name: "Palestine", flag: "🇵🇸", aliases: ["palestine", "فلسطين", "فلسطيني"]),
        .init(id: "turkey", name: "Türkiye", flag: "🇹🇷", aliases: ["turkey", "turkiye", "türkiye", "turkish", "tr", "تركيا", "تركي"]),
        .init(id: "iran", name: "Iran", flag: "🇮🇷", aliases: ["iran", "persian", "ir", "ايران", "إيران", "فارسي"]),
        .init(id: "united-kingdom", name: "United Kingdom", flag: "🇬🇧", aliases: ["united kingdom", "great britain", "britain", "england", "uk", "gb", "british"]),
        .init(id: "united-states", name: "United States", flag: "🇺🇸", aliases: ["united states", "america", "usa", "us", "american"]),
        .init(id: "canada", name: "Canada", flag: "🇨🇦", aliases: ["canada", "ca", "canadian"]),
        .init(id: "spain", name: "Spain", flag: "🇪🇸", aliases: ["spain", "espana", "españa", "spanish", "es"]),
        .init(id: "france", name: "France", flag: "🇫🇷", aliases: ["france", "french", "fr", "francais", "français"]),
        .init(id: "italy", name: "Italy", flag: "🇮🇹", aliases: ["italy", "italia", "italian", "it"]),
        .init(id: "germany", name: "Germany", flag: "🇩🇪", aliases: ["germany", "deutschland", "german", "de"]),
        .init(id: "portugal", name: "Portugal", flag: "🇵🇹", aliases: ["portugal", "portuguese", "pt"]),
        .init(id: "netherlands", name: "Netherlands", flag: "🇳🇱", aliases: ["netherlands", "holland", "dutch", "nl"]),
        .init(id: "belgium", name: "Belgium", flag: "🇧🇪", aliases: ["belgium", "belgique", "belgie", "be"]),
        .init(id: "greece", name: "Greece", flag: "🇬🇷", aliases: ["greece", "greek", "gr"]),
        .init(id: "russia", name: "Russia", flag: "🇷🇺", aliases: ["russia", "russian", "ru", "россия"]),
        .init(id: "ukraine", name: "Ukraine", flag: "🇺🇦", aliases: ["ukraine", "ukrainian", "ua", "україна"]),
        .init(id: "poland", name: "Poland", flag: "🇵🇱", aliases: ["poland", "polish", "pl", "polska"]),
        .init(id: "romania", name: "Romania", flag: "🇷🇴", aliases: ["romania", "romanian", "ro"]),
        .init(id: "mexico", name: "Mexico", flag: "🇲🇽", aliases: ["mexico", "méxico", "mx"]),
        .init(id: "brazil", name: "Brazil", flag: "🇧🇷", aliases: ["brazil", "brasil", "br"]),
        .init(id: "argentina", name: "Argentina", flag: "🇦🇷", aliases: ["argentina", "ar"]),
        .init(id: "colombia", name: "Colombia", flag: "🇨🇴", aliases: ["colombia", "co"]),
        .init(id: "chile", name: "Chile", flag: "🇨🇱", aliases: ["chile", "cl"]),
        .init(id: "peru", name: "Peru", flag: "🇵🇪", aliases: ["peru", "perú", "pe"]),
        .init(id: "india", name: "India", flag: "🇮🇳", aliases: ["india", "hindi", "in"]),
        .init(id: "pakistan", name: "Pakistan", flag: "🇵🇰", aliases: ["pakistan", "urdu", "pk"]),
        .init(id: "philippines", name: "Philippines", flag: "🇵🇭", aliases: ["philippines", "pinoy", "filipino", "ph"]),
        .init(id: "indonesia", name: "Indonesia", flag: "🇮🇩", aliases: ["indonesia", "indonesian", "id"]),
        .init(id: "japan", name: "Japan", flag: "🇯🇵", aliases: ["japan", "japanese", "jp", "日本"]),
        .init(id: "south-korea", name: "South Korea", flag: "🇰🇷", aliases: ["south korea", "korea", "korean", "kr", "한국"]),
        .init(id: "china", name: "China", flag: "🇨🇳", aliases: ["china", "chinese", "cn", "中国"]),
        .init(id: "arabic", name: "Arabic", flag: "🌍", aliases: ["arabic", "arab", "عربي", "العربية", "عرب"])
    ]
}
