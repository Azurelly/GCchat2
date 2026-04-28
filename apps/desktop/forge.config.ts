import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { PublisherGithub } from "@electron-forge/publisher-github";
import releaseConfig from "../../release.config.json";

const config: ForgeConfig = {
  packagerConfig: {
    name: "GCChat",
    executableName: "GCChat",
    asar: true
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "GCChat",
      authors: "GCChat",
      description: "A Discord-inspired messaging app."
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({})
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: releaseConfig.githubOwner,
        name: releaseConfig.githubRepo
      },
      draft: false,
      prerelease: false
    })
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main"
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    })
  ]
};

export default config;
