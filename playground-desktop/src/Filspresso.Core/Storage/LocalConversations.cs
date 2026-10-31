using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Filspresso.Core.Api;

namespace Filspresso.Core.Storage;

public sealed record LocalConversation(string Id, string Title, DateTimeOffset UpdatedAt, SavedTranscriptMessage[] Messages);

/// <summary>Per-account, per-conversation local files; no server sync or fixed conversation count.</summary>
public sealed class LocalConversations(string directory)
{
    private string AccountDirectory(string account)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(account);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(account.Trim().ToLowerInvariant()))).ToLowerInvariant();
        return Path.Combine(directory, "conversations", hash);
    }

    private static string FileName(string id)
    {
        if (!Guid.TryParseExact(id, "D", out var parsed)) throw new ArgumentException("Invalid conversation id.", nameof(id));
        return parsed.ToString("D") + ".json";
    }

    public void Save(string account, LocalConversation conversation)
    {
        ArgumentNullException.ThrowIfNull(conversation);
        var folder = AccountDirectory(account);
        var target = Path.Combine(folder, FileName(conversation.Id));
        Directory.CreateDirectory(folder);
        var temporary = Path.Combine(folder, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, conversation);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, target, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public LocalConversation[] List(string account)
    {
        var folder = AccountDirectory(account);
        if (!Directory.Exists(folder)) return Array.Empty<LocalConversation>();
        return Directory.EnumerateFiles(folder, "*.json", SearchOption.TopDirectoryOnly)
            .Select(path =>
            {
                try
                {
                    var conversation = JsonSerializer.Deserialize<LocalConversation>(File.ReadAllText(path));
                    return conversation is not null && FileName(conversation.Id) == Path.GetFileName(path) && conversation.Messages is not null ? conversation : null;
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { return null; }
            }).Where(item => item is not null).Select(item => item!).OrderByDescending(item => item.UpdatedAt).ToArray();
    }
}
