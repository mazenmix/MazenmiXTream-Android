import { app } from "nitron";

const hamzaVariant = process.env.MX_VARIANT === "hamza";

app.init({
  name: hamzaVariant ? "HamzaXTream" : "MazenmiXTream",
  packageId: hamzaVariant ? "com.hamzaxtream.mx" : "com.mazenmix.tream",
  version: "1.1.6",
  entry: "index.html",
  orientation: "auto",
  statusBar: false,
  permissions: ["INTERNET", "ACCESS_NETWORK_STATE", "WAKE_LOCK"],
  icon: { src: "assets/icon.png", background: "#08090c" }
});
