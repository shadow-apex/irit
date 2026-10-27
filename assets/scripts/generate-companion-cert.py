"""
scripts/generate-companion-cert.py — Tự động sinh chứng chỉ SSL tự ký cho Companion Camera HTTPS (cổng 8444).
Hỗ trợ Safari trên iOS và Chrome trên Android mở camera (getUserMedia) qua mạng LAN mà không bị chặn.
"""
import datetime
import ipaddress
import os
import socket

def generate_cert():
    cert_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "PHONE_CAMERA", "cert")
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")

    if os.path.exists(cert_path) and os.path.exists(key_path):
        return True

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
    except ImportError:
        return False

    ips = [ipaddress.ip_address("127.0.0.1")]
    try:
        hostname = socket.gethostname()
        for item in socket.getaddrinfo(hostname, None):
            ip_str = item[4][0]
            try:
                ip = ipaddress.ip_address(ip_str)
                if not ip.is_loopback and not ip.is_link_local and isinstance(ip, ipaddress.IPv4Address):
                    if ip not in ips:
                        ips.append(ip)
            except Exception:
                pass
    except Exception:
        pass

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    san_list = [x509.DNSName("localhost")]
    for ip in ips:
        san_list.append(x509.IPAddress(ip))

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "VN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Iris Companion"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Iris Local Server"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    os.makedirs(cert_dir, exist_ok=True)
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return True

if __name__ == "__main__":
    generate_cert()
