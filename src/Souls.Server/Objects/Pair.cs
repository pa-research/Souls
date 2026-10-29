namespace Souls.Server.Objects;

public sealed class Pair<T>(T first, T second)
{
    public T First { get; set; } = first;
    public T Second { get; set; } = second;
}
