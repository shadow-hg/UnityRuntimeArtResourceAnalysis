import React, { useState } from 'react';

const ConnectionPanel = ({ onConnect }) => {
    const [ip, setIp] = useState('');
    const [port, setPort] = useState('');
    const [isConnected, setIsConnected] = useState(false);

    const handleConnect = () => {
        if (ip && port) {
            onConnect(ip, port);
            setIsConnected(true);
        }
    };

    const handleDisconnect = () => {
        onConnect('', '');
        setIsConnected(false);
    };

    return (
        <div className="connection-panel">
            <h2>Connection Panel</h2>
            <div>
                <input
                    type="text"
                    placeholder="Enter IP Address"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Enter Port"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                />
            </div>
            <div>
                {isConnected ? (
                    <button onClick={handleDisconnect}>Disconnect</button>
                ) : (
                    <button onClick={handleConnect}>Connect</button>
                )}
            </div>
            {isConnected && <p>Connected to {ip}:{port}</p>}
        </div>
    );
};

export default ConnectionPanel;