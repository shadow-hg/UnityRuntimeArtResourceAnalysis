import React from 'react';

const Toolbar: React.FC<{ onConnect: () => void; onDisconnect: () => void; isConnected: boolean }> = ({ onConnect, onDisconnect, isConnected }) => {
    return (
        <div className="toolbar">
            <button onClick={isConnected ? onDisconnect : onConnect}>
                {isConnected ? 'Disconnect' : 'Connect'}
            </button>
        </div>
    );
};

export default Toolbar;