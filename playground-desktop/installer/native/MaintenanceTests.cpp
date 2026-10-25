#include "Maintenance.h"
#include <windows.h>
#include <wincred.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

static void Check(bool value, const char* message) { if (!value) throw std::runtime_error(message); std::cout << "PASS " << message << '\n'; }

int main() {
    const auto id = std::to_wstring(GetCurrentProcessId());
    const auto root = std::filesystem::temp_directory_path() / (L"FilspressoMaintenanceTest-" + id);
    const auto owned = root / L"Filspresso" / L"Playground";
    const auto neighbor = root / L"OtherApplication";
    const std::wstring prefix = L"Filspresso.Playground.Tests.Maintenance-" + id;
    int exitCode = 0;
    try {
        std::filesystem::create_directories(owned / L"nested");
        std::filesystem::create_directories(neighbor);
        std::ofstream(owned / L"nested" / L"preferences.json") << "test";
        std::ofstream(neighbor / L"keep.txt") << "keep";
        Check(FilspressoMaintenance::DeleteOwnedTree(owned.wstring()), "application data removed recursively");
        Check(!std::filesystem::exists(owned), "application-owned directory removed");
        Check(std::filesystem::exists(neighbor / L"keep.txt"), "neighboring data preserved");
        Check(FilspressoMaintenance::DeleteOwnedTree(owned.wstring()), "cleanup is idempotent");

        std::filesystem::create_directory(owned);
        const auto command = L"cmd.exe /d /c mklink /J \"" + (owned / L"external").wstring() + L"\" \"" + neighbor.wstring() + L"\" >nul";
        if (_wsystem(command.c_str()) != 0) throw std::runtime_error("could not create junction fixture");
        Check(FilspressoMaintenance::DeleteOwnedTree(owned.wstring()), "junction removed without traversal");
        Check(std::filesystem::exists(neighbor / L"keep.txt"), "junction target preserved");

        const auto sandbox = owned / L"windows-sandbox";
        std::filesystem::create_directories(sandbox);
        Check(FilspressoMaintenance::SandboxStateCanBeRemoved(sandbox.wstring()), "empty sandbox state is removable");
        std::ofstream(sandbox / L"fixture.intent") << "unresolved";
        Check(!FilspressoMaintenance::SandboxStateCanBeRemoved(sandbox.wstring()), "unresolved VM intent blocks uninstall cleanup");
        std::filesystem::remove(sandbox / L"fixture.intent");
        std::ofstream(sandbox / L"fixture.uncertain") << "ambiguous";
        Check(!FilspressoMaintenance::SandboxStateCanBeRemoved(sandbox.wstring()), "ambiguous VM creation blocks uninstall cleanup");
        std::filesystem::remove(sandbox / L"fixture.uncertain");
        const auto lease = CreateFileW((sandbox / L"owner.lock").c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, CREATE_NEW, 0, nullptr);
        Check(lease != INVALID_HANDLE_VALUE, "active sandbox lease fixture created");
        Check(!FilspressoMaintenance::SandboxStateCanBeRemoved(sandbox.wstring()), "active sandbox owner blocks uninstall cleanup");
        CloseHandle(lease);
        Check(FilspressoMaintenance::SandboxStateCanBeRemoved(sandbox.wstring()), "released sandbox state permits cleanup");

        for (const auto suffix : { L"/session", L"/device-id" }) {
            auto target = prefix + suffix;
            wchar_t blob[] = L"fixture";
            CREDENTIALW credential{}; credential.Type = CRED_TYPE_GENERIC; credential.TargetName = target.data();
            credential.CredentialBlob = reinterpret_cast<LPBYTE>(blob); credential.CredentialBlobSize = sizeof(blob);
            credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
            Check(CredWriteW(&credential, 0) != FALSE, "private credential fixture created");
        }
        Check(FilspressoMaintenance::ClearCredentials(prefix), "saved sign-in and device identity removed");
        for (const auto suffix : { L"/session", L"/device-id" }) {
            PCREDENTIALW credential = nullptr;
            Check(CredReadW((prefix + suffix).c_str(), CRED_TYPE_GENERIC, 0, &credential) == FALSE && GetLastError() == ERROR_NOT_FOUND, "credential is no longer present");
        }
        Check(FilspressoMaintenance::ClearCredentials(prefix), "credential cleanup is idempotent");
    } catch (const std::exception& error) { std::cerr << "FAIL " << error.what() << '\n'; exitCode = 1; }
    FilspressoMaintenance::ClearCredentials(prefix);
    FilspressoMaintenance::DeleteOwnedTree(root.wstring());
    return exitCode;
}
