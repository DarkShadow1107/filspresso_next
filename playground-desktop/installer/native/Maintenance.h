#pragma once
#include <string>

namespace FilspressoMaintenance {
    inline constexpr wchar_t UpgradeCode[] = L"{6F2C1A9E-4B7D-4E52-9C31-8D0A5E7B1F44}";
    inline constexpr wchar_t CredentialPrefix[] = L"Filspresso.Playground";
    bool DeleteOwnedTree(const std::wstring& path);
    bool ClearCredentials(const std::wstring& prefix);
    bool CleanupCurrentUser();
    int LaunchUninstall();
}
