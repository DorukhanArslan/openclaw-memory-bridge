"""Verified HTTPS using native OS trust plus a portable public CA bundle."""
from __future__ import annotations

import os
from pathlib import Path
import ssl


def _ca_location(name, *, directory=False):
    value = os.environ.get(name)
    if value is None or value == "":
        return None
    if len(value) > 16384 or any(character in value for character in "\r\n\0"):
        raise RuntimeError(f"Invalid {name} certificate configuration.")
    path = Path(value)
    try:
        valid = path.is_dir() if directory else path.is_file()
    except OSError:
        valid = False
    if not valid:
        kind = "directory" if directory else "PEM file"
        raise RuntimeError(f"{name} must point to a readable certificate {kind}.")
    return value


def create_tls_context():
    """Do not change global SSL behavior or weaken certificate verification.

    Native trust includes macOS Keychain and Windows certificate stores.
    Certifi supplies public roots even when Python's own CA file is missing.
    Explicit CA locations supplement these roots and are never ignored.
    """
    try:
        import certifi
        import truststore
    except ImportError:
        raise RuntimeError(
            "Chat HTTPS support is missing. Install it with the server's Python: "
            "python -m pip install './python[chat]', then restart Memory Chat."
        ) from None

    locations = [
        ("SSL_CERT_FILE", _ca_location("SSL_CERT_FILE"), False),
        ("SSL_CERT_DIR", _ca_location("SSL_CERT_DIR", directory=True), True),
        ("NODE_EXTRA_CA_CERTS", _ca_location("NODE_EXTRA_CA_CERTS"), False),
    ]
    try:
        context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.verify_mode = ssl.CERT_REQUIRED
        context.check_hostname = True
        context.load_default_certs()
        context.load_verify_locations(cafile=certifi.where())
    except (OSError, ValueError, ssl.SSLError):
        raise RuntimeError(
            "The system certificate store or public CA bundle could not be loaded. "
            "Reinstall chat HTTPS support with python -m pip install --upgrade './python[chat]'."
        ) from None
    for name, location, directory in locations:
        if location is not None:
            try:
                context.load_verify_locations(**{"capath" if directory else "cafile": location})
            except (OSError, ValueError, ssl.SSLError):
                raise RuntimeError(f"{name} could not be loaded as trusted PEM certificates.") from None
    return context
