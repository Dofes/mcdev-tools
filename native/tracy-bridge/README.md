# MC Dev Tools Tracy Bridge

This Windows x64 DLL embeds the Tracy 0.11.1 server worker used by the game's
native profiler endpoint. It exposes a small C ABI for the VS Code extension;
no Tracy C++ types cross the DLL boundary.

The first release intentionally permits one active capture per extension host.
Tracy 0.11.1 server code contains process-global accounting and progress state,
so concurrent workers require upstream isolation work and stress testing first.

Configure, build, test, and install from an x64 MSVC developer shell:

```powershell
cmake --preset x64-msvc-release
cmake --build --preset x64-msvc-release
ctest --preset x64-msvc-release
cmake --install build/x64-msvc-release
```

The Release preset installs the reviewed DLL and third-party licenses directly to
`bin/native/windows/x64`. This is an explicit native-maintenance workflow:
`npm run build`, `vscode:prepublish`, and VSCE packaging never invoke CMake.

Dependencies are immutable FetchContent archives with SHA-256 verification.
Dependency source, this C++ project, and native build trees are excluded from the
extension; the VSIX contains only the fixed runtime artifacts under `bin`.
