using System;
using System.IO;
using System.Linq;
using Filspresso.Core.Api;
using Filspresso.Core.Storage;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class LocalConversationsTests
{
    [Fact]
    public void SavesAccountScopedMessagesAndToolActivityWithoutAConversationCountCap()
    {
        var root = Path.Combine(Path.GetTempPath(), "FilspressoLocalConversationsTests", Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalConversations(root);
            for (var i = 0; i < 35; i++)
            {
                var id = Guid.NewGuid().ToString();
                store.Save("one@example.com", new LocalConversation(id, "Conversation", DateTimeOffset.UtcNow,
                [new SavedTranscriptMessage { Id = "message", Role = "assistant", Content = "  exact\n", Tools = [new SavedToolActivity { Id = "tool", Name = "read_file", Arguments = "{}", Status = "finished", Result = "ok" }] }]));
            }
            var saved = store.List("one@example.com");
            Assert.Equal(35, saved.Length);
            Assert.Equal("  exact\n", saved[0].Messages.Single().Content);
            Assert.Equal("read_file", saved[0].Messages.Single().Tools!.Single().Name);
            Assert.Empty(store.List("other@example.com"));
            Assert.Throws<ArgumentException>(() => store.Save("one@example.com", new LocalConversation("../escape", "x", DateTimeOffset.UtcNow, [])));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }
}
