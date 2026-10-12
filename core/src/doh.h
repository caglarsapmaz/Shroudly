#ifndef SHROUDLY_DOH_H
#define SHROUDLY_DOH_H

#include "platform.h"

/* Minimal DNS-over-HTTPS A/AAAA resolver.
 * The DoH server is reached over TLS with the desync engine applied to its own
 * ClientHello, so even the resolver connection survives SNI-based blocking.
 * Results are cached. Thread-safe. */

void doh_init(const char *doh_host, const char *doh_ip);
/* Resolve name; fills sockaddr_storage + len. want6: prefer AAAA.
 * Returns 0 on success. Falls back to the OS resolver if DoH fails. */
int  doh_resolve(const char *name, uint16_t port, int want6,
                 struct sockaddr_storage *out, socklen_t *outlen);
void doh_clear_cache(void);

/* Point the resolver at a local DoH forwarder (127.0.0.1:port) that speaks real
 * encrypted DNS; tried before the public UDP resolvers. port<=0 disables it. */
void doh_set_local(const char *ip, int port);

/* Add an ISP block-page / sinkhole IPv4 (dotted). Such answers are rejected
 * like bogons. Turk Telekom's 195.175.254.2 is built in. */
void doh_add_block_ip(const char *ip);

/* True if a resolved address is a censorship answer (block page or bogon). */
int  doh_addr_is_block(const struct sockaddr_storage *sa);

#endif
