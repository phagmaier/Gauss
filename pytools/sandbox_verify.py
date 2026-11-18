"""Start a confined command and report its wait status separately from output."""

import os
import struct
import subprocess
import sys


if __name__ == "__main__":
    path, *argv = sys.argv[1:]
    with open(path, "r+b") as status:
        # The server already holds this file open. Remove its name before the
        # command starts; subprocess does not pass the descriptor to the child.
        os.unlink(path)
        try:
            child = subprocess.Popen(argv)
        except OSError as error:
            print(error, file=sys.stderr)
            code = 256  # Not a possible exit status; exec failed.
        else:
            code = child.wait()  # Negative when the child died by signal.
        status.write(struct.pack("!i", code))
