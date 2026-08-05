# MC Dev Tools Tracy Bridge

This Windows x64 DLL embeds the Tracy 0.11.1 server worker used by the game's
native profiler endpoint. It exposes a small C ABI for the VS Code extension;
no Tracy C++ types cross the DLL boundary.

## Runtime source of truth

The extension now ships the same reviewed `mcdev-tracy-bridge.dll` artifact as
MCDK. MCDK is the source of truth for the runtime DLL so both tools use the same
Tracy protocol implementation, safety limits, and result format. The shared
runtime files are kept together under `bin/native/windows/x64`:

```text
mcdk.exe
mcdev-tracy-bridge.dll
mcdk-api.dll
koffi.node
```

This local CMake project is retained for native maintenance and verification. It
is not an independent release source. Before replacing the packaged DLL with a
local build, first synchronize this project with MCDK's Tracy bridge source and
review the resulting ABI and behavior. Installing an out-of-sync local build
would make MCDK and the extension behave differently.

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

The Release preset can install the DLL and third-party licenses under
`bin/native/windows/x64`, replacing the packaged MCDK artifact. Use that step
only for an explicitly reviewed, MCDK-synchronized native update. Normal plugin
builds must keep using the checked-in artifact: `npm run build`,
`vscode:prepublish`, and VSCE packaging never invoke CMake.

Dependencies are immutable FetchContent archives with SHA-256 verification.
Dependency source, this C++ project, and native build trees are excluded from the
extension; the VSIX contains only the fixed runtime artifacts under `bin`.
