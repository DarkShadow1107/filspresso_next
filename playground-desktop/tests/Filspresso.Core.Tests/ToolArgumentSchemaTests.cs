using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Filspresso.Harness;
using Xunit;

namespace Filspresso.Core.Tests;

public sealed class ToolArgumentSchemaTests
{
    private static ToolArgumentSchema Schema() => new(new Dictionary<string, ToolParameter>
    {
        ["path"] = new(ToolParameterKind.WorkspacePath),
        ["text"] = new(ToolParameterKind.String, MinLength: 1, MaxLength: 20),
        ["count"] = new(ToolParameterKind.Integer, Minimum: 1, Maximum: 30),
        ["flag"] = new(ToolParameterKind.Boolean, Required: false),
    });

    [Theory]
    [InlineData("{\"path\":\"src/main.cs\",\"text\":\"hello\",\"count\":2}")]
    [InlineData("{\"path\":\"src/main.cs\",\"text\":\"hello\",\"count\":2,\"flag\":false}")]
    public void ValidArgumentsAndOptionalFieldsAreAccepted(string arguments) => Assert.True(Schema().TryValidate(arguments, out _));

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("not json")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\"}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":\"2\"}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":2.5}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":31}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":0}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":2,\"flag\":1}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":2,\"extra\":false}")]
    [InlineData("{\"path\":\"a\",\"text\":null,\"count\":2}")]
    [InlineData("{\"path\":\"a\",\"text\":\"\",\"count\":2}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":2,\"count\":3}")]
    [InlineData("{\"path\":\"a\",\"text\":\"hello\",\"count\":2,\"co\\u0075nt\":3}")]
    [InlineData("{\"path\":\"a\",\"text\":{\"nested\":{\"again\":{\"deep\":{}}}},\"count\":2}")]
    [InlineData("{\"path\":\"a\",\"text\":\"\\uD800\",\"count\":2}")]
    [InlineData("{\"path\":\"a\",\"text\":\"\\uDC00\",\"count\":2}")]
    public void BadShapesTypesBoundsExtrasAndDuplicateFieldsAreRejected(string arguments)
    { Assert.False(Schema().TryValidate(arguments, out var error)); Assert.NotEmpty(error); }

    [Fact]
    public void ArgumentBoundsCountUtf8BytesNotOnlyCharacters()
    {
        var schema = new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["text"] = new(ToolParameterKind.String, MaxLength: 16_384) });
        Assert.False(schema.TryValidate("{\"text\":\"" + new string('x', 16_384) + "\"}", out _));
        Assert.False(schema.TryValidate("{\"text\":\"" + new string('界', 6000) + "\"}", out _));
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("src/../../outside")]
    [InlineData("/absolute")]
    [InlineData("C:/Windows/System32")]
    [InlineData("C:relative")]
    [InlineData("a\\b")]
    [InlineData("//host/share")]
    [InlineData("file.txt:stream")]
    [InlineData("a/./file")]
    [InlineData("a//file")]
    [InlineData("a/")]
    [InlineData("NUL.txt")]
    [InlineData("NUL .txt")]
    [InlineData("CONIN$")]
    [InlineData("CONOUT$")]
    [InlineData("src/COM1")]
    [InlineData("src/LPT².txt")]
    [InlineData("src/file.")]
    [InlineData("src/file ")]
    [InlineData("src/\nfile")]
    public void WorkspacePathsRejectTraversalAbsoluteAndWindowsAliasForms(string path)
    {
        Assert.False(ToolArgumentSchema.IsWorkspacePath(path));
        var schema = new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["path"] = new(ToolParameterKind.WorkspacePath) });
        Assert.False(schema.TryValidate(JsonSerializer.Serialize(new { path }), out _));
    }

    [Fact]
    public void JsonSchemaAndValidationUseTheSameImmutableParameterDefinitions()
    {
        var fields = new Dictionary<string, ToolParameter> { ["text"] = new(ToolParameterKind.String, MaxLength: 3) };
        var schema = new ToolArgumentSchema(fields); fields.Clear();
        Assert.True(schema.TryValidate("{\"text\":\"abc\"}", out _));
        Assert.False(schema.TryValidate("{\"text\":\"abcd\"}", out _));
        var advertised = schema.ToJsonSchema();
        Assert.False(advertised.GetProperty("additionalProperties").GetBoolean());
        Assert.Equal(3, advertised.GetProperty("properties").GetProperty("text").GetProperty("maxLength").GetInt32());
        Assert.Equal("text", Assert.Single(advertised.GetProperty("required").EnumerateArray()).GetString());
        Assert.Throws<NotSupportedException>(() => ((IDictionary<string, ToolParameter>)schema.Properties).Clear());
    }

    [Fact]
    public void JsonSchemaStringLengthsCountUnicodeScalarsAndInvalidSurrogatesAreRefused()
    {
        var schema = new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["text"] = new(ToolParameterKind.String, MinLength: 1, MaxLength: 1) });
        Assert.True(schema.TryValidate("{\"text\":\"😀\"}", out _));
        Assert.False(schema.TryValidate("{\"text\":\"😀😀\"}", out _));
        Assert.False(schema.TryValidate("{\"text\":\"" + '\uD800' + "\"}", out _));
    }

    [Fact]
    public void InvalidSchemaDefinitionsAreRejectedRatherThanCoerced()
    {
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["bad name"] = new(ToolParameterKind.String) }));
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["text"] = new(ToolParameterKind.String, MinLength: 5, MaxLength: 2) }));
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["text"] = new((ToolParameterKind)999) }));
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["path"] = new(ToolParameterKind.WorkspacePath, MinLength: 241, MaxLength: 300) }));
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(new Dictionary<string, ToolParameter> { ["path"] = new(ToolParameterKind.WorkspacePath, MaxLength: 0) }));
        Assert.Throws<ArgumentException>(() => new ToolArgumentSchema(Enumerable.Range(0, 33).ToDictionary(index => "field" + index, _ => new ToolParameter(ToolParameterKind.String))));
    }
}
