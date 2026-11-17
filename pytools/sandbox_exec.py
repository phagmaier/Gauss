"""Exec a Linux sandbox workload with reconnectable socketpairs disabled.

The sandbox runtime blocks socket(AF_UNIX), but its filter permits socketpair.
A datagram endpoint from a pair can be reconnected to a host Unix socket. This
additional, inherited seccomp filter closes that route AFTER the runtime has
started its own relays and namespace helper. A stream pair stays allowed: it
is connected for good (connect fails with EISCONN), and uv's runtime (tokio's
signal handling) and Python's asyncio need one. No compiler or extra package
is needed; sandbox.ts runs this with the project's Python and -I.
"""

import ctypes
import errno
import os
import platform
import sys


class SockFilter(ctypes.Structure):
    _fields_ = [
        ("code", ctypes.c_ushort),
        ("jt", ctypes.c_ubyte),
        ("jf", ctypes.c_ubyte),
        ("k", ctypes.c_uint32),
    ]


class SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(SockFilter))]


def block_reconnectable_socketpairs():
    # Linux audit architecture values and native syscall numbers. A foreign
    # ABI is killed, not allowed to bypass the native syscall check.
    architecture, socketpair = {
        "x86_64": (0xC000003E, 53),
        "aarch64": (0xC00000B7, 199),
    }[platform.machine()]
    # The type argument carries SOCK_NONBLOCK and SOCK_CLOEXEC above its low
    # four bits. Both architectures are little-endian, so the low half of
    # args[1] is at offset 24.
    instructions = (SockFilter * 11)(
        SockFilter(0x20, 0, 0, 4),              # LD seccomp_data.arch
        SockFilter(0x15, 1, 0, architecture),  # JEQ native architecture
        SockFilter(0x06, 0, 0, 0x80000000),    # RET KILL_PROCESS
        SockFilter(0x20, 0, 0, 0),            # LD seccomp_data.nr
        SockFilter(0x54, 0, 0, 0xBFFFFFFF),    # AND ~__X32_SYSCALL_BIT
        SockFilter(0x15, 0, 4, socketpair),    # JEQ socketpair, else ALLOW
        SockFilter(0x20, 0, 0, 24),           # LD seccomp_data.args[1], low
        SockFilter(0x54, 0, 0, 0xF),           # AND the socket type's bits
        SockFilter(0x15, 1, 0, 1),             # JEQ SOCK_STREAM, to ALLOW
        SockFilter(0x06, 0, 0, 0x00050000 | errno.EPERM),  # RET ERRNO
        SockFilter(0x06, 0, 0, 0x7FFF0000),    # RET ALLOW
    )
    program = SockFprog(len(instructions), instructions)
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
    prctl.restype = ctypes.c_int
    # seccomp(2): an unprivileged filter requires PR_SET_NO_NEW_PRIVS first.
    for option, argument, pointer in [
        (38, 1, 0),  # PR_SET_NO_NEW_PRIVS
        (22, 2, ctypes.cast(ctypes.pointer(program), ctypes.c_void_p).value),
    ]:  # PR_SET_SECCOMP, SECCOMP_MODE_FILTER
        if prctl(option, argument, pointer, 0, 0) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))


if __name__ == "__main__":
    block_reconnectable_socketpairs()
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
