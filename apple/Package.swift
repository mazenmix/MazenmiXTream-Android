// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "MazenmiXTreamCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "MazenmiXTreamCore", targets: ["MazenmiXTreamCore"])
    ],
    targets: [
        .target(
            name: "MazenmiXTreamCore",
            path: "MazenmiXTreamCore/Sources/MazenmiXTreamCore"
        ),
        .testTarget(
            name: "MazenmiXTreamCoreTests",
            dependencies: ["MazenmiXTreamCore"],
            path: "MazenmiXTreamCore/Tests/MazenmiXTreamCoreTests"
        )
    ]
)
