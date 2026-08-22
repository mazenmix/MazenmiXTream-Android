# MazenmiXTream for Samsung Smart TV

This folder is the Samsung Tizen TV layer for MazenmiXTream 1.1.6. It uses Samsung AVPlay for hardware-accelerated HLS, MPEG-TS and progressive playback while reusing the existing Xtream Codes, M3U, EPG, favorites, search, VOD and Series interface.

## Build

From the repository root:

```bash
npm install
npm run build:tizen
```

The importable Tizen Studio project is generated at `dist-tizen/MazenmiXTream-Samsung-Tizen`, together with `MazenmiXTream-Samsung-Tizen-Project.zip`.

## Sign and install

1. Install Tizen Studio, TV Extensions and Samsung Certificate Extension.
2. In Certificate Manager, create a Samsung TV certificate profile for the target television.
3. Import the generated project into Tizen Studio.
4. Turn Developer Mode on in the television Apps screen, enter the development computer IP and reboot the TV.
5. Connect the TV in Device Manager, then run the project as a Tizen Web Application. Tizen Studio signs and installs the WGT with the selected certificate profile.

The unsigned project cannot be installed until it is signed with the Samsung author/distributor certificates for the target TV.

## Remote controls

- D-pad and Enter: navigation and selection
- Back: close dialog/player/sidebar, then exit from the root screen
- Channel Up/Down: switch live channel while watching
- Play/Pause: playback control
- Red: favorite the current item
- Blue: change aspect ratio

Playlist credentials and settings remain on the television in local storage. The app includes no analytics or advertising SDK.
