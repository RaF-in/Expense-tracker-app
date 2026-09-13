using System.ComponentModel.DataAnnotations;

namespace ExpenseTracker.CoreApi.Auth;

/// <summary>
/// Auth0 configuration, bound from the <c>Auth0__Domain</c> / <c>Auth0__Audience</c>
/// environment variables (k8s maps <c>AUTH0_*</c> Secret keys onto them via secretKeyRef).
/// Validated at host build via <c>ValidateOnStart()</c> — an invalid value must exit
/// before the server listens, so the pod crash-loops naming the setting (N1) instead
/// of going green and 401ing every request.
/// </summary>
public sealed class Auth0Options : IValidatableObject
{
    public const string SectionName = "Auth0";

    /// <summary>
    /// Bare Auth0 host with no scheme (e.g. <c>dev-xxxx.us.auth0.com</c>).
    /// <c>Authority</c> is derived as <c>https://{Domain}/</c> — the trailing slash
    /// is required by the OIDC discovery convention.
    /// </summary>
    [Required]
    public string Domain { get; set; } = string.Empty;

    /// <summary>Must equal the Auth0 API Identifier exactly.</summary>
    [Required]
    public string Audience { get; set; } = string.Empty;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // A scheme or path in Domain silently produces a broken MetadataAddress
        // (https://https://... or a truncated issuer) that fails far from the cause.
        if (Domain.Contains("://") || Domain.StartsWith("http", StringComparison.OrdinalIgnoreCase) || Domain.Contains('/'))
        {
            yield return new ValidationResult(
                "Auth0:Domain must be a bare hostname with no scheme or path (e.g. dev-xxxx.us.auth0.com)",
                new[] { nameof(Domain) });
        }
    }
}
