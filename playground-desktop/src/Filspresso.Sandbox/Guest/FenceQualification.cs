// Executed only by explicit qualification/tests, never offered as an agent tool.
namespace Filspresso.Guest
{
    public static class FenceQualification
    {
        public static void Races(string root)
        {
            var child = System.IO.Path.Combine(root, "race");
            var moved = child + "-moved";
            System.IO.Directory.CreateDirectory(child);
            System.IO.File.WriteAllText(System.IO.Path.Combine(child, "sentinel"), "original");
            using (var pin = new Fence(root, child, false))
            using (var file = pin.Open("sentinel", false))
            {
                var succeeded = 0;
                var attacker = new System.Threading.Thread(delegate()
                {
                    for (var i = 0; i < 1000; i++)
                    {
                        try { System.IO.Directory.Move(child, moved); System.Threading.Interlocked.Increment(ref succeeded); }
                        catch (System.IO.IOException) { }
                        try { System.IO.File.WriteAllText(System.IO.Path.Combine(child, "sentinel"), "changed"); System.Threading.Interlocked.Increment(ref succeeded); }
                        catch (System.IO.IOException) { }
                    }
                });
                attacker.Start();
                if (!attacker.Join(10000)) throw new System.IO.IOException("Race test exceeded budget");
                if (succeeded != 0) throw new System.IO.IOException("Pinned path was mutated");
            }
            // The same operations must work after releasing the pins (no false-positive test).
            System.IO.Directory.Move(child, moved);
            System.IO.Directory.Move(moved, child);
            System.IO.File.WriteAllText(System.IO.Path.Combine(child, "sentinel"), "released");
        }
    }
}
